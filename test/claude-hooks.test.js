import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installClaudeHooks, removeClaudeHooks, hookEvents } from "../lib/claude-hooks.js";

test("installs and removes only the presence lifecycle hooks", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-presence-hooks-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const settingsPath = path.join(root, "settings.json");
  const existing = {
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: "existing-hook" }] }],
    },
  };
  await fs.writeFile(settingsPath, JSON.stringify(existing), "utf8");
  const paths = { claudeSettings: settingsPath };

  await installClaudeHooks(paths);
  let settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, "existing-hook");
  for (const event of hookEvents) {
    assert.ok(settings.hooks[event].some((group) => group.hooks.some((hook) => hook.command.includes("CLAUDE_CODEX_PRESENCE_HOOK"))));
  }

  await removeClaudeHooks(paths);
  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, "existing-hook");
  for (const event of hookEvents) {
    assert.ok(!(settings.hooks[event] || []).some((group) => group.hooks.some((hook) => hook.command.includes("CLAUDE_CODEX_PRESENCE_HOOK"))));
  }
});
