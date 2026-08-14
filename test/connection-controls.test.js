import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the tray exposes an explicit Discord reconnect control", async () => {
  const tray = await fs.readFile(path.join(root, "scripts", "tray.ps1"), "utf8");
  assert.match(tray, /New-Button "Connect Discord"/u);
  assert.match(tray, /Invoke-Punchcard @\("connect", "--json"\)/u);
  assert.match(tray, /\$connectButton\.Visible = -not \$connected/u);
  assert.match(tray, /\$connectItem\.Visible = -not \$connected/u);
});

test("the connect command restarts IPC and the daemon stays connected while idle", async () => {
  const [cli, daemon] = await Promise.all([
    fs.readFile(path.join(root, "bin", "cli.js"), "utf8"),
    fs.readFile(path.join(root, "lib", "daemon.js"), "utf8"),
  ]);
  assert.match(cli, /import path from "node:path";/u);
  assert.match(cli, /case "connect":/u);
  assert.match(cli, /timeoutMs = 15_000/u);
  assert.match(cli, /waitForDiscordConnection\(pid\)/u);
  assert.match(daemon, /else if \(!activity && !discord\?\.ready\) \{\s*await discord\.connect\(\);/u);
});
