import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { appPaths } from "./paths.js";

export const CLAUDE_ACTIVITY_STALE_MS = 12 * 60 * 60 * 1000;

function safeId(value) {
  return createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 24);
}

function markerName(kind, sessionId, agentId = "main") {
  return `${kind}-${safeId(sessionId)}-${safeId(agentId)}.json`;
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
  try { entries = await fs.readdir(paths.claudeActivity, { withFileTypes: true }); } catch {
    return { activeAgents: 0, mainAgents: 0, subagents: 0, agents: [] };
  }
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
  return {
    activeAgents: agents.length,
    mainAgents: agents.filter((agent) => agent.kind === "main").length,
    subagents: agents.filter((agent) => agent.kind === "subagent").length,
    agents,
  };
}

export function addClaudeDesktopBackground(activity, backgroundAgents = 0) {
  const desktopBackgroundAgents = Math.max(0, Number(backgroundAgents) || 0);
  return {
    ...activity,
    desktopBackgroundAgents,
    activeAgents: (activity.activeAgents || 0) + desktopBackgroundAgents,
    mainAgents: (activity.mainAgents || 0) + desktopBackgroundAgents,
  };
}

export async function clearClaudeActivity(paths = appPaths()) {
  await fs.rm(paths.claudeActivity, { recursive: true, force: true });
}
