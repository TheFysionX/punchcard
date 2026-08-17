import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { appPaths } from "./paths.js";

export const CLAUDE_ACTIVITY_STALE_MS = 12 * 60 * 60 * 1000;
export const CLAUDE_FILESYSTEM_ACTIVITY_STALE_MS = 30 * 60 * 1000;

const workflowJournalCache = new Map();
const directAgentCache = new Map();

function safeId(value) {
  return createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 24);
}

function markerName(kind, sessionId, agentId = "main") {
  return `${kind}-${safeId(sessionId)}-${safeId(agentId)}.json`;
}

function workflowAgentKey(sessionId, agentId) {
  return `${sessionId}:${agentId}`;
}

async function readWorkflowJournal(file, sessionId, workflowId, staleBefore) {
  let stat;
  try { stat = await fs.stat(file); } catch {
    return { knownAgentKeys: new Set(), agents: [] };
  }
  let text;
  let parsed = workflowJournalCache.get(file);
  if (!parsed || parsed.mtimeMs !== stat.mtimeMs || parsed.size !== stat.size) {
    try { text = await fs.readFile(file, "utf8"); } catch {
      return { knownAgentKeys: new Set(), agents: [] };
    }
    const knownAgentIds = new Set();
    const activeAgentIds = new Set();
    for (const line of text.split(/\r?\n/u)) {
      if (!line) continue;
      let item;
      try { item = JSON.parse(line); } catch { continue; }
      if (typeof item.agentId !== "string" || !item.agentId) continue;
      knownAgentIds.add(item.agentId);
      if (item.type === "started") activeAgentIds.add(item.agentId);
      else if (item.type === "result") activeAgentIds.delete(item.agentId);
    }
    parsed = { mtimeMs: stat.mtimeMs, size: stat.size, knownAgentIds, activeAgentIds };
    workflowJournalCache.set(file, parsed);
  }
  const knownAgentKeys = new Set();
  for (const agentId of parsed.knownAgentIds) {
    knownAgentKeys.add(workflowAgentKey(sessionId, agentId));
  }
  const agents = [];
  for (const agentId of parsed.activeAgentIds) {
    const transcriptPath = path.join(path.dirname(file), `agent-${agentId}.jsonl`);
    const transcriptStat = await fs.stat(transcriptPath).catch(() => null);
    if ((transcriptStat?.mtimeMs ?? stat.mtimeMs) < staleBefore) continue;
    agents.push({
        kind: "subagent",
        sessionId,
        agentId,
        agentType: "workflow-subagent",
        workflowId,
        cwd: null,
        transcriptPath: transcriptStat ? transcriptPath : null,
        startedAt: new Date(transcriptStat?.birthtimeMs || stat.birthtimeMs).toISOString(),
    });
  }
  return { knownAgentKeys, agents };
}

async function discoverClaudeSessionRoots(claudeProjects) {
  if (!claudeProjects) return [];
  let projects = [];
  try { projects = await fs.readdir(claudeProjects, { withFileTypes: true }); } catch { return []; }
  const roots = [];
  await Promise.all(projects.filter((entry) => entry.isDirectory()).map(async (project) => {
    const projectRoot = path.join(claudeProjects, project.name);
    let sessions = [];
    try { sessions = await fs.readdir(projectRoot, { withFileTypes: true }); } catch { return; }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const sessionRoot = path.join(projectRoot, session.name);
      roots.push({
        sessionId: session.name,
        sessionRoot,
        subagentsRoot: path.join(sessionRoot, "subagents"),
        workflowsRoot: path.join(sessionRoot, "subagents", "workflows"),
      });
    }
  }));
  return roots;
}

function mergeClaudeSessionRoots(mainAgents, discoveredRoots) {
  const roots = new Map();
  for (const root of discoveredRoots) roots.set(`${root.sessionId}:${root.sessionRoot}`, root);
  for (const agent of mainAgents) {
    if (agent?.kind !== "main" || !agent.sessionId || !agent.transcriptPath) continue;
    const sessionRoot = path.join(path.dirname(agent.transcriptPath), agent.sessionId);
    roots.set(`${agent.sessionId}:${sessionRoot}`, {
      sessionId: agent.sessionId,
      sessionRoot,
      subagentsRoot: path.join(sessionRoot, "subagents"),
      workflowsRoot: path.join(sessionRoot, "subagents", "workflows"),
    });
  }
  return [...roots.values()];
}

export async function readClaudeWorkflowActivity(mainAgents, options = {}) {
  const knownAgentKeys = new Set();
  const activeByKey = new Map();
  const now = options.now || new Date();
  const staleBefore = now.valueOf() - CLAUDE_FILESYSTEM_ACTIVITY_STALE_MS;
  const discoveredRoots = options.sessionRoots || await discoverClaudeSessionRoots(options.claudeProjects);
  const sessionRoots = mergeClaudeSessionRoots(mainAgents, discoveredRoots);
  for (const { workflowsRoot: root, sessionId } of sessionRoots) {
    let entries = [];
    try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const result = await readWorkflowJournal(
        path.join(root, entry.name, "journal.jsonl"),
        sessionId,
        entry.name,
        staleBefore,
      );
      for (const key of result.knownAgentKeys) knownAgentKeys.add(key);
      for (const agent of result.agents) {
        activeByKey.set(workflowAgentKey(agent.sessionId, agent.agentId), agent);
      }
    }
  }
  return { knownAgentKeys, agents: [...activeByKey.values()] };
}

async function readFileTail(file, maxBytes = 512 * 1024) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const start = stat.size - length;
    if (length > 0) await handle.read(buffer, 0, length, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      const newline = text.indexOf("\n");
      text = newline >= 0 ? text.slice(newline + 1) : "";
    }
    return { stat, text };
  } finally {
    await handle.close();
  }
}

async function readDirectClaudeSubagent(file, sessionId, staleBefore) {
  let stat;
  try { stat = await fs.stat(file); } catch { return null; }
  if (stat.mtimeMs < staleBefore) return null;
  let parsed = directAgentCache.get(file);
  if (!parsed || parsed.mtimeMs !== stat.mtimeMs || parsed.size !== stat.size) {
    let tail;
    try { tail = await readFileTail(file); } catch { return null; }
    let completed = false;
    let agentType = "subagent";
    let cwd = null;
    let startedAt = null;
    for (const line of tail.text.split(/\r?\n/u)) {
      if (!line) continue;
      let item;
      try { item = JSON.parse(line); } catch { continue; }
      if (!startedAt && item.timestamp) startedAt = item.timestamp;
      if (item.cwd) cwd = item.cwd;
      if (item.attributionAgent) agentType = item.attributionAgent;
      if (item.type === "assistant") completed = item.message?.stop_reason === "end_turn";
    }
    parsed = { mtimeMs: stat.mtimeMs, size: stat.size, completed, agentType, cwd, startedAt };
    directAgentCache.set(file, parsed);
  }
  if (parsed.completed) return null;
  const agentId = path.basename(file, ".jsonl").replace(/^agent-/u, "");
  return {
    kind: "subagent",
    sessionId,
    agentId,
    agentType: parsed.agentType,
    cwd: parsed.cwd,
    transcriptPath: file,
    startedAt: parsed.startedAt || new Date(stat.birthtimeMs).toISOString(),
  };
}

async function readDirectClaudeSubagents(sessionRoots, now) {
  const staleBefore = now.valueOf() - CLAUDE_FILESYSTEM_ACTIVITY_STALE_MS;
  const knownAgentKeys = new Set();
  const agents = [];
  for (const { sessionId, subagentsRoot } of sessionRoots) {
    let entries = [];
    try { entries = await fs.readdir(subagentsRoot, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !/^agent-.+\.jsonl$/u.test(entry.name)) continue;
      const agentId = entry.name.slice("agent-".length, -".jsonl".length);
      knownAgentKeys.add(workflowAgentKey(sessionId, agentId));
      const agent = await readDirectClaudeSubagent(path.join(subagentsRoot, entry.name), sessionId, staleBefore);
      if (agent) agents.push(agent);
    }
  }
  return { knownAgentKeys, agents };
}

async function writeMarker(directory, kind, input) {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, markerName(kind, input.session_id, input.agent_id));
  const marker = {
    kind,
    sessionId: input.session_id || "unknown",
    agentId: input.agent_id || null,
    agentType: input.agent_type || (kind === "main" ? "main" : "unknown"),
    cwd: input.cwd || null,
    transcriptPath: input.transcript_path || input.agent_transcript_path || null,
    startedAt: new Date().toISOString(),
  };
  await fs.writeFile(file, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

async function removeMarker(directory, kind, input) {
  const file = path.join(directory, markerName(kind, input.session_id, input.agent_id));
  await fs.rm(file, { force: true });
}

async function removeSession(directory, sessionId) {
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
  await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const file = path.join(directory, entry.name);
    try {
      const marker = JSON.parse(await fs.readFile(file, "utf8"));
      if (marker.sessionId === sessionId) await fs.rm(file, { force: true });
    } catch {}
  }));
}

export async function recordClaudeHook(input, paths = appPaths()) {
  const event = input?.hook_event_name;
  if (!event || !input.session_id) return { handled: false, event };
  switch (event) {
    case "UserPromptSubmit":
      await writeMarker(paths.claudeActivity, "main", input);
      break;
    case "Stop":
    case "StopFailure":
      await removeMarker(paths.claudeActivity, "main", input);
      break;
    case "SubagentStart":
      if (input.agent_id) await writeMarker(paths.claudeActivity, "subagent", input);
      break;
    case "SubagentStop":
      if (input.agent_id) await removeMarker(paths.claudeActivity, "subagent", input);
      break;
    case "SessionEnd":
      await removeSession(paths.claudeActivity, input.session_id);
      break;
    default:
      return { handled: false, event };
  }
  return { handled: true, event };
}

export async function readClaudeActivity(paths = appPaths(), now = new Date()) {
  let entries = [];
  try { entries = await fs.readdir(paths.claudeActivity, { withFileTypes: true }); } catch {}
  const staleBefore = now.valueOf() - CLAUDE_ACTIVITY_STALE_MS;
  const agents = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(paths.claudeActivity, entry.name);
    try {
      const marker = JSON.parse(await fs.readFile(file, "utf8"));
      const started = new Date(marker.startedAt).valueOf();
      if (!Number.isFinite(started) || started < staleBefore) {
        await fs.rm(file, { force: true });
        continue;
      }
      agents.push(marker);
    } catch {
      await fs.rm(file, { force: true });
    }
  }
  const mainAgents = agents.filter((agent) => agent.kind === "main");
  const sessionRoots = await discoverClaudeSessionRoots(paths.claudeProjects);
  const [workflows, directSubagents] = await Promise.all([
    readClaudeWorkflowActivity(mainAgents, { sessionRoots, now }),
    readDirectClaudeSubagents(sessionRoots, now),
  ]);
  const filesystemAgentKeys = new Set([
    ...workflows.knownAgentKeys,
    ...directSubagents.knownAgentKeys,
  ]);
  const reconciledAgents = agents.filter((agent) => {
    if (agent.kind !== "subagent") return true;
    return !filesystemAgentKeys.has(workflowAgentKey(agent.sessionId, agent.agentId));
  });
  const filesystemAgents = new Map();
  for (const agent of [...workflows.agents, ...directSubagents.agents]) {
    filesystemAgents.set(workflowAgentKey(agent.sessionId, agent.agentId), agent);
  }
  for (const agent of filesystemAgents.values()) reconciledAgents.push(agent);
  return {
    activeAgents: reconciledAgents.length,
    mainAgents: reconciledAgents.filter((agent) => agent.kind === "main").length,
    subagents: reconciledAgents.filter((agent) => agent.kind === "subagent").length,
    agents: reconciledAgents,
  };
}

export function addClaudeDesktopBackground(activity, backgroundAgents = 0) {
  const desktopBackgroundAgents = Math.max(0, Number(backgroundAgents) || 0);
  const mainAgents = Math.max(activity.mainAgents || 0, desktopBackgroundAgents);
  const subagents = activity.subagents || 0;
  return {
    ...activity,
    desktopBackgroundAgents,
    activeAgents: mainAgents + subagents,
    mainAgents,
    subagents,
  };
}

export async function clearClaudeActivity(paths = appPaths()) {
  await fs.rm(paths.claudeActivity, { recursive: true, force: true });
}
