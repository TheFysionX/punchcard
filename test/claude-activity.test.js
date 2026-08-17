import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addClaudeDesktopBackground, recordClaudeHook, readClaudeActivity } from "../lib/claude-activity.js";

test("tracks real Claude turns and subagents from lifecycle events", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-presence-claude-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = { claudeActivity: path.join(root, "activity") };

  await recordClaudeHook({ hook_event_name: "UserPromptSubmit", session_id: "session-a", cwd: root }, paths);
  await recordClaudeHook({ hook_event_name: "SubagentStart", session_id: "session-a", agent_id: "agent-1", agent_type: "Explore" }, paths);
  let snapshot = await readClaudeActivity(paths);
  assert.equal(snapshot.activeAgents, 2);
  assert.equal(snapshot.mainAgents, 1);
  assert.equal(snapshot.subagents, 1);

  await recordClaudeHook({ hook_event_name: "SubagentStop", session_id: "session-a", agent_id: "agent-1" }, paths);
  await recordClaudeHook({ hook_event_name: "Stop", session_id: "session-a" }, paths);
  snapshot = await readClaudeActivity(paths);
  assert.equal(snapshot.activeAgents, 0);
});

test("does not double-count a Claude Desktop main agent already tracked by hooks", () => {
  const combined = addClaudeDesktopBackground({ activeAgents: 1, mainAgents: 1, subagents: 0, agents: [] }, 1);
  assert.equal(combined.activeAgents, 1);
  assert.equal(combined.mainAgents, 1);
  assert.equal(combined.desktopBackgroundAgents, 1);
});

test("uses Claude workflow journals to replace incomplete workflow hooks", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-presence-workflow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sessionId = "session-workflow";
  const project = path.join(root, "project");
  const transcriptPath = path.join(project, `${sessionId}.jsonl`);
  const workflow = path.join(project, sessionId, "subagents", "workflows", "wf-one");
  const paths = { claudeActivity: path.join(root, "activity") };
  await fs.mkdir(workflow, { recursive: true });
  await fs.writeFile(transcriptPath, "", "utf8");
  await recordClaudeHook({ hook_event_name: "UserPromptSubmit", session_id: sessionId, transcript_path: transcriptPath }, paths);
  await recordClaudeHook({
    hook_event_name: "SubagentStart",
    session_id: sessionId,
    agent_id: "finished-agent",
    agent_type: "workflow-subagent",
  }, paths);
  await fs.writeFile(path.join(workflow, "journal.jsonl"), [
    JSON.stringify({ type: "started", agentId: "finished-agent", key: "one" }),
    JSON.stringify({ type: "result", agentId: "finished-agent", key: "one", result: {} }),
    JSON.stringify({ type: "started", agentId: "live-agent", key: "two" }),
    "",
  ].join("\n"), "utf8");

  let snapshot = await readClaudeActivity(paths);
  assert.equal(snapshot.mainAgents, 1);
  assert.equal(snapshot.subagents, 1);
  assert.equal(snapshot.activeAgents, 2);
  assert.equal(snapshot.agents.find((agent) => agent.kind === "subagent").agentId, "live-agent");

  await fs.appendFile(
    path.join(workflow, "journal.jsonl"),
    `${JSON.stringify({ type: "result", agentId: "live-agent", key: "two", result: {} })}\n`,
    "utf8",
  );
  snapshot = await readClaudeActivity(paths);
  assert.equal(snapshot.mainAgents, 1);
  assert.equal(snapshot.subagents, 0);
  assert.equal(snapshot.activeAgents, 1);
});

test("discovers hookless Claude Deep Research workflow agents", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-deep-research-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sessionId = "deep-research-session";
  const workflow = path.join(root, "projects", "project-one", sessionId, "subagents", "workflows", "wf-deep");
  const activity = path.join(root, "missing-hook-markers");
  await fs.mkdir(workflow, { recursive: true });
  const started = Array.from({ length: 36 }, (_, index) => ({
    type: "started",
    key: `research-${index}`,
    agentId: `research-agent-${index}`,
  }));
  await fs.writeFile(
    path.join(workflow, "journal.jsonl"),
    `${started.map((item) => JSON.stringify(item)).join("\n")}\n`,
    "utf8",
  );

  const snapshot = await readClaudeActivity({
    claudeActivity: activity,
    claudeProjects: path.join(root, "projects"),
  });

  assert.equal(snapshot.mainAgents, 0);
  assert.equal(snapshot.subagents, 36);
  assert.equal(snapshot.activeAgents, 36);
});

test("does not resurrect abandoned hookless Claude workflows", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-stale-workflow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sessionId = "abandoned-session";
  const workflow = path.join(root, "projects", "project-one", sessionId, "subagents", "workflows", "wf-old");
  const journal = path.join(workflow, "journal.jsonl");
  const transcript = path.join(workflow, "agent-abandoned-agent.jsonl");
  await fs.mkdir(workflow, { recursive: true });
  await fs.writeFile(journal, `${JSON.stringify({ type: "started", agentId: "abandoned-agent" })}\n`, "utf8");
  await fs.writeFile(transcript, `${JSON.stringify({ type: "assistant", message: { stop_reason: "tool_use" } })}\n`, "utf8");
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(journal, old, old);
  await fs.utimes(transcript, old, old);

  const snapshot = await readClaudeActivity({
    claudeActivity: path.join(root, "activity"),
    claudeProjects: path.join(root, "projects"),
  });

  assert.equal(snapshot.activeAgents, 0);
  assert.equal(snapshot.subagents, 0);
});

test("discovers active direct Claude subagents and excludes completed ones", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-direct-subagents-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sessionId = "direct-session";
  const subagents = path.join(root, "projects", "project-one", sessionId, "subagents");
  await fs.mkdir(subagents, { recursive: true });
  await fs.writeFile(path.join(subagents, "agent-live.jsonl"), [
    JSON.stringify({ type: "assistant", attributionAgent: "sol", message: { stop_reason: "tool_use" }, timestamp: new Date().toISOString() }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result" }] }, timestamp: new Date().toISOString() }),
    "",
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(subagents, "agent-finished.jsonl"), `${JSON.stringify({
    type: "assistant",
    attributionAgent: "sonnet-grind",
    message: { stop_reason: "end_turn" },
    timestamp: new Date().toISOString(),
  })}\n`, "utf8");

  const snapshot = await readClaudeActivity({
    claudeActivity: path.join(root, "activity"),
    claudeProjects: path.join(root, "projects"),
  });

  assert.equal(snapshot.activeAgents, 1);
  assert.equal(snapshot.subagents, 1);
  assert.equal(snapshot.agents[0].agentId, "live");
  assert.equal(snapshot.agents[0].agentType, "sol");
});
