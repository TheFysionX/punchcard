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

test("adds live Claude Desktop background agents to hook activity", () => {
  const combined = addClaudeDesktopBackground({ activeAgents: 1, mainAgents: 1, subagents: 0, agents: [] }, 1);
  assert.equal(combined.activeAgents, 2);
  assert.equal(combined.mainAgents, 2);
  assert.equal(combined.desktopBackgroundAgents, 1);
});
