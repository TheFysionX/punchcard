import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalTelemetry } from "../lib/usage.js";

test("aggregates Codex deltas and deduplicates Claude message snapshots", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-presence-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexSessions = path.join(root, "codex");
  const claudeProjects = path.join(root, "claude");
  await fs.mkdir(codexSessions, { recursive: true });
  await fs.mkdir(claudeProjects, { recursive: true });
  const now = new Date();
  const yesterday = new Date(now.valueOf() - 86_400_000).toISOString();
  const eightDaysAgo = new Date(now.valueOf() - (8 * 86_400_000)).toISOString();
  const idleSubagent = new Date(now.valueOf() - (10 * 60_000)).toISOString();
  const abandonedMain = new Date(now.valueOf() - (6 * 60_000)).toISOString();
  const today = now.toISOString();
  await fs.writeFile(path.join(codexSessions, "one.jsonl"), [
    JSON.stringify({ timestamp: today, type: "session_meta", payload: { id: "main", thread_source: "user" } }),
    JSON.stringify({ timestamp: today, type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ timestamp: today, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 5_000 }, last_token_usage: { total_tokens: 5_000 } } } }),
    JSON.stringify({ timestamp: eightDaysAgo, type: "turn_context", payload: {} }),
    JSON.stringify({ timestamp: eightDaysAgo, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 5_777 }, last_token_usage: { total_tokens: 777 } } } }),
    JSON.stringify({ timestamp: yesterday, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 6_776 }, last_token_usage: { total_tokens: 999 } } } }),
    JSON.stringify({ timestamp: today, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 6_896 }, last_token_usage: { total_tokens: 120 } } } }),
    JSON.stringify({ timestamp: today, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 6_896 }, last_token_usage: { total_tokens: 120 } } } }),
    "",
  ].join("\n"));
  await fs.writeFile(path.join(codexSessions, "subagent.jsonl"), [
    JSON.stringify({ timestamp: idleSubagent, type: "session_meta", payload: { id: "sub", thread_source: "subagent", agent_path: "/root/test", source: { subagent: { thread_spawn: { parent_thread_id: "main" } } } } }),
    JSON.stringify({ timestamp: idleSubagent, type: "session_meta", payload: { id: "inherited-main", thread_source: "user" } }),
    JSON.stringify({ timestamp: idleSubagent, type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ timestamp: idleSubagent, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 50_000 }, last_token_usage: { total_tokens: 50_000 } } } }),
    JSON.stringify({ timestamp: idleSubagent, type: "turn_context", payload: {} }),
    JSON.stringify({ timestamp: idleSubagent, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 50_100 }, last_token_usage: { total_tokens: 100 } } } }),
    JSON.stringify({ timestamp: idleSubagent, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 50_100 }, last_token_usage: { total_tokens: 100 } } } }),
    "",
  ].join("\n"));
  await fs.writeFile(path.join(codexSessions, "abandoned-main.jsonl"), [
    JSON.stringify({ timestamp: abandonedMain, type: "session_meta", payload: { id: "abandoned", thread_source: "user" } }),
    JSON.stringify({ timestamp: abandonedMain, type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ timestamp: abandonedMain, type: "turn_context", payload: {} }),
    "",
  ].join("\n"));
  await fs.writeFile(path.join(codexSessions, "orphan-subagent.jsonl"), [
    JSON.stringify({ timestamp: today, type: "session_meta", payload: { id: "orphan-sub", thread_source: "subagent", agent_path: "/root/orphan", source: { subagent: { thread_spawn: { parent_thread_id: "missing-parent" } } } } }),
    JSON.stringify({ timestamp: today, type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ timestamp: today, type: "turn_context", payload: {} }),
    "",
  ].join("\n"));
  const usageA = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 10 };
  const usageB = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 20 };
  await fs.writeFile(path.join(claudeProjects, "one.jsonl"), [
    JSON.stringify({ timestamp: today, type: "assistant", sessionId: "s", uuid: "u1", message: { id: "m1", usage: usageA } }),
    JSON.stringify({ timestamp: today, type: "assistant", sessionId: "s", uuid: "u2", message: { id: "m1", usage: usageB } }),
    JSON.stringify({ timestamp: today, type: "assistant", sessionId: "copied-session", uuid: "u3", message: { id: "m1", usage: usageB } }),
    "",
  ].join("\n"));
  const telemetry = new LocalTelemetry({ codexSessions, claudeProjects });
  const snapshot = await telemetry.refresh(now);
  assert.equal(snapshot.codexTokens, 220);
  assert.equal(snapshot.claudeTokens, 122);
  assert.equal(snapshot.totalTokens, 342);
  assert.equal(snapshot.codexTokensWeek, 1_219);
  assert.equal(snapshot.claudeTokensWeek, 122);
  assert.equal(snapshot.totalTokensWeek, 1_341);
  assert.equal(snapshot.codexActiveAgents, 2);
  assert.equal(snapshot.codexMainAgents, 1);
  assert.equal(snapshot.codexSubagents, 1);
});

test("counts an open idle sidechat after its current turn completes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-presence-sidechat-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexSessions = path.join(root, "codex");
  const claudeProjects = path.join(root, "claude");
  await fs.mkdir(codexSessions, { recursive: true });
  await fs.mkdir(claudeProjects, { recursive: true });
  const now = new Date();
  const timestamp = now.toISOString();

  await fs.writeFile(path.join(codexSessions, "main.jsonl"), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id: "main", thread_source: "user" } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started" } }),
    "",
  ].join("\n"));
  await fs.writeFile(path.join(codexSessions, "sidechat.jsonl"), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id: "sidechat", thread_source: "subagent", agent_path: "/root/sidechat", source: { subagent: { thread_spawn: { parent_thread_id: "main" } } } } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_complete" } }),
    "",
  ].join("\n"));

  const telemetry = new LocalTelemetry(
    { codexSessions, claudeProjects, codexState: path.join(root, "state_5.sqlite") },
    { readCodexSidechats: async () => ({ available: true, ids: new Set(["sidechat"]) }) },
  );
  const snapshot = await telemetry.refresh(now);
  assert.equal(snapshot.codexMainAgents, 1);
  assert.equal(snapshot.codexSubagents, 1);
  assert.equal(snapshot.codexActiveAgents, 2);
});

test("counts desktop sidechat tabs that do not have rollout or spawn-edge records", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-presence-ui-sidechat-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexSessions = path.join(root, "codex");
  const claudeProjects = path.join(root, "claude");
  await fs.mkdir(codexSessions, { recursive: true });
  await fs.mkdir(claudeProjects, { recursive: true });
  const now = new Date();
  const timestamp = now.toISOString();
  await fs.writeFile(path.join(codexSessions, "main.jsonl"), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id: "main", thread_source: "user" } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started" } }),
    "",
  ].join("\n"));

  const telemetry = new LocalTelemetry(
    { codexSessions, claudeProjects },
    {
      readCodexSidechats: async () => ({ available: true, ids: new Set() }),
      readCodexUiSidechats: async () => ({ available: true, ids: new Set(["ui-sidechat-a", "ui-sidechat-b"]) }),
    },
  );
  const snapshot = await telemetry.refresh(now, { codexDesktopOpen: true });
  assert.equal(snapshot.codexMainAgents, 1);
  assert.equal(snapshot.codexSubagents, 2);
  assert.equal(snapshot.codexActiveAgents, 3);
});

test("counts an active desktop sidechat while its parent main task is idle", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-presence-idle-parent-ui-sidechat-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexSessions = path.join(root, "codex");
  const claudeProjects = path.join(root, "claude");
  await fs.mkdir(codexSessions, { recursive: true });
  await fs.mkdir(claudeProjects, { recursive: true });
  const now = new Date();
  const timestamp = now.toISOString();
  await fs.writeFile(path.join(codexSessions, "main.jsonl"), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id: "main", thread_source: "user" } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_complete" } }),
    "",
  ].join("\n"));

  const telemetry = new LocalTelemetry(
    { codexSessions, claudeProjects, codexGlobalState: path.join(root, "global-state.json") },
    {
      readCodexSidechats: async () => ({ available: false, ids: new Set() }),
      readCodexUiSidechats: async (_globalStatePath, codexDesktopOpen) => {
        assert.equal(codexDesktopOpen, true);
        return { available: true, ids: new Set(["active-ui-sidechat"]) };
      },
    },
  );
  const snapshot = await telemetry.refresh(now, { codexDesktopOpen: true });
  assert.equal(snapshot.codexMainAgents, 0);
  assert.equal(snapshot.codexSubagents, 1);
  assert.equal(snapshot.codexActiveAgents, 1);
});

test("does not count an interrupted sidechat merely because its spawn edge remains open", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-presence-interrupted-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexSessions = path.join(root, "codex");
  const claudeProjects = path.join(root, "claude");
  await fs.mkdir(codexSessions, { recursive: true });
  await fs.mkdir(claudeProjects, { recursive: true });
  const now = new Date();
  const timestamp = now.toISOString();
  await fs.writeFile(path.join(codexSessions, "main.jsonl"), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id: "main", thread_source: "user" } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started" } }),
    "",
  ].join("\n"));
  await fs.writeFile(path.join(codexSessions, "sidechat.jsonl"), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id: "sidechat", thread_source: "subagent", source: { subagent: { thread_spawn: { parent_thread_id: "main" } } } } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "turn_aborted" } }),
    "",
  ].join("\n"));
  const telemetry = new LocalTelemetry(
    { codexSessions, claudeProjects, codexState: path.join(root, "state_5.sqlite") },
    { readCodexSidechats: async () => ({ available: true, ids: new Set(["sidechat"]) }) },
  );
  const snapshot = await telemetry.refresh(now);
  assert.equal(snapshot.codexMainAgents, 1);
  assert.equal(snapshot.codexSubagents, 0);
});

test("keeps a working sidechat active while its known parent is quiet", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-presence-working-sidechat-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexSessions = path.join(root, "codex");
  const claudeProjects = path.join(root, "claude");
  await fs.mkdir(codexSessions, { recursive: true });
  await fs.mkdir(claudeProjects, { recursive: true });
  const now = new Date();
  const timestamp = now.toISOString();
  await fs.writeFile(path.join(codexSessions, "main.jsonl"), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id: "main", thread_source: "user" } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_complete" } }),
    "",
  ].join("\n"));
  await fs.writeFile(path.join(codexSessions, "sidechat.jsonl"), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id: "sidechat", thread_source: "subagent", source: { subagent: { thread_spawn: { parent_thread_id: "main" } } } } }),
    JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started" } }),
    "",
  ].join("\n"));
  const telemetry = new LocalTelemetry(
    { codexSessions, claudeProjects },
    { readCodexSidechats: async () => ({ available: false, ids: new Set() }) },
  );
  const snapshot = await telemetry.refresh(now);
  assert.equal(snapshot.codexMainAgents, 0);
  assert.equal(snapshot.codexSubagents, 1);
  assert.equal(snapshot.codexActiveAgents, 1);
});
