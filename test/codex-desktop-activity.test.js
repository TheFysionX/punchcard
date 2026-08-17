import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyCodexDesktopLifecycleLine,
  CodexDesktopActivity,
} from "../lib/codex-desktop-activity.js";

const sidechatId = "01a002c4-ac25-7aa0-92bf-64eb9d09eada";

function startLine(id = sidechatId) {
  return `2026-08-15T00:36:12.701Z info [AppServerConnection] response_routed conversationId=${id} errorCode=null method=turn/start`;
}

function completeLine(id = sidechatId) {
  return `2026-08-15T00:38:38.765Z info [electron-message-handler] [desktop-notifications] show turn-complete conversationId=${id} turnId=turn`;
}

test("desktop lifecycle counts only turns whose latest event is start", () => {
  const active = new Set();
  applyCodexDesktopLifecycleLine(active, startLine());
  assert.deepEqual([...active], [sidechatId]);
  applyCodexDesktopLifecycleLine(active, completeLine());
  assert.deepEqual([...active], []);
});

test("desktop lifecycle reader tails the current Codex process log", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-codex-desktop-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const logDirectory = path.join(root, "2026", "08", "15");
  await fs.mkdir(logDirectory, { recursive: true });
  const log = path.join(logDirectory, "codex-desktop-session-123-t0-i1-000000-0.log");
  await fs.writeFile(log, `${startLine()}\n`, "utf8");

  const activity = new CodexDesktopActivity([root]);
  let result = await activity.refresh(new Date(), { codexDesktopOpen: true, codexDesktopPids: [123] });
  assert.deepEqual([...result.ids], [sidechatId]);

  await fs.appendFile(log, `${completeLine()}\n`, "utf8");
  result = await activity.refresh(new Date(), { codexDesktopOpen: true, codexDesktopPids: [123] });
  assert.deepEqual([...result.ids], []);

  await fs.appendFile(log, `${startLine()}\n`, "utf8");
  result = await activity.refresh(new Date(), { codexDesktopOpen: false, codexDesktopPids: [] });
  assert.equal(result.available, false);
  assert.deepEqual([...result.ids], []);
});

test("desktop lifecycle reader ignores an older app session that reused the same PID", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-codex-pid-reuse-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const logDirectory = path.join(root, "2026", "08", "15");
  await fs.mkdir(logDirectory, { recursive: true });
  const oldLog = path.join(logDirectory, "codex-desktop-old-123-t0-i1-000000-0.log");
  const currentLog = path.join(logDirectory, "codex-desktop-current-123-t0-i1-000000-0.log");
  await fs.writeFile(oldLog, `${startLine()}\n`, "utf8");
  await fs.writeFile(currentLog, "2026-08-15T00:40:00.000Z info app started\n", "utf8");
  const oldTime = new Date("2026-08-15T00:30:00.000Z");
  const currentTime = new Date("2026-08-15T00:40:00.000Z");
  await fs.utimes(oldLog, oldTime, oldTime);
  await fs.utimes(currentLog, currentTime, currentTime);

  const activity = new CodexDesktopActivity([root]);
  const result = await activity.refresh(new Date(), { codexDesktopOpen: true, codexDesktopPids: [123] });
  assert.deepEqual([...result.ids], []);
});
