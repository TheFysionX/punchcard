import assert from "node:assert/strict";
import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { readSettings } from "../lib/state.js";

const execFile = promisify(nodeExecFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "cli.js");

async function fixture(context) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-display-settings-"));
  context.after(() => fs.rm(home, { recursive: true, force: true }));
  return home;
}

test("Discord display fields are visible by default", async (context) => {
  const home = await fixture(context);
  const settings = await readSettings({ home, settings: path.join(home, "settings.json") });
  assert.equal(settings.showAgentCount, true);
  assert.equal(settings.showDailyTokens, true);
  assert.equal(settings.showWeeklyTokens, true);
});

test("display commands persist each visibility setting independently", async (context) => {
  const home = await fixture(context);
  const run = async (...arguments_) => {
    const result = await execFile(process.execPath, [cli, "display", ...arguments_, "--json"], {
      cwd: root,
      env: { ...process.env, CLAUDE_CODEX_PRESENCE_HOME: home },
    });
    return JSON.parse(result.stdout);
  };

  assert.deepEqual(await run("agents", "off"), { agents: false, daily: true, weekly: true });
  assert.deepEqual(await run("daily", "off"), { agents: false, daily: false, weekly: true });
  assert.deepEqual(await run("weekly", "off"), { agents: false, daily: false, weekly: false });
  assert.deepEqual(await run("agents", "on"), { agents: true, daily: false, weekly: false });
});

test("Windows settings panel exposes all three Discord visibility toggles", async () => {
  const tray = await fs.readFile(path.join(root, "scripts", "tray.ps1"), "utf8");
  assert.match(tray, /New-Toggle "Show agent count"/u);
  assert.match(tray, /New-Toggle "Show daily token usage"/u);
  assert.match(tray, /New-Toggle "Show weekly token usage"/u);
  assert.match(tray, /"display", "agents"/u);
  assert.match(tray, /"display", "daily"/u);
  assert.match(tray, /"display", "weekly"/u);
});
