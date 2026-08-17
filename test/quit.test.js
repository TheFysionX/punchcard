import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Quit closes the current session without disabling Punchcard", async () => {
  const [cli, tray] = await Promise.all([
    fs.readFile(path.join(root, "bin", "cli.js"), "utf8"),
    fs.readFile(path.join(root, "scripts", "tray.ps1"), "utf8"),
  ]);
  const quitCase = cli.match(/case "quit": \{([\s\S]*?)\n  \}\n  case "toggle":/u)?.[1] || "";

  assert.match(quitCase, /await requestTrayExit\(paths\);/u);
  assert.match(quitCase, /await stopDaemon\(\);/u);
  assert.match(quitCase, /if \(!process\.argv\.includes\("--from-tray"\)\) await stopTray\(paths\);/u);
  assert.doesNotMatch(quitCase, /writeSettings|removeAutostart|removeClaudeHooks|clearClaudeActivity/u);
  assert.match(tray, /\$quitButton\.add_Click\(\{\s*\[void\]\(Invoke-Punchcard @\("quit", "--from-tray"\)\)/u);
  assert.match(tray, /\$quickQuitItem\.add_Click\(\{ \[void\]\(Invoke-Punchcard @\("quit", "--from-tray"\)\)/u);
});
