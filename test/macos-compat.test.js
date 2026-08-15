import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installAutostart, launchAgentPlist, removeAutostart } from "../lib/autostart.js";
import { findNpmCli } from "../lib/npm-cli.js";
import { appPaths } from "../lib/paths.js";
import { parseUnixProcessOutputs, summarizeProcesses } from "../lib/processes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("macOS LaunchAgent owns the menu-bar supervisor and only restarts crashes", () => {
  const plist = launchAgentPlist({ nodeExecutable: "/opt/homebrew/bin/node", cliPath: "/opt/homebrew/lib/node_modules/punchcard-presence/bin/cli.js" });
  assert.match(plist, /<string>tray-host<\/string>\s*<string>--login<\/string>/u);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<dict>\s*<key>Crashed<\/key>\s*<true\/>/u);
  assert.match(plist, /<key>LimitLoadToSessionType<\/key>\s*<string>Aqua<\/string>/u);
  assert.doesNotMatch(plist, /<key>KeepAlive<\/key>\s*<true\/>/u);
  assert.doesNotMatch(plist, /<string>run<\/string>/u);
});

test("macOS login integration bootstraps, secures, and removes the user LaunchAgent", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-mac-autostart-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const calls = [];
  let loaded = false;
  const execute = async (file, arguments_) => {
    calls.push([file, ...arguments_]);
    if (arguments_[0] === "print" && arguments_[1] === "gui/501/com.punchcard.presence") {
      if (!loaded) throw new Error("not loaded");
      return { stdout: "", stderr: "" };
    }
    if (arguments_[0] === "bootstrap" && arguments_[2]?.endsWith("com.punchcard.presence.plist")) loaded = true;
    if (arguments_[0] === "bootout" && arguments_[1] === "gui/501/com.punchcard.presence") loaded = false;
    return { stdout: "", stderr: "" };
  };

  const installed = await installAutostart({
    platform: "darwin",
    home,
    uid: 501,
    env: {},
    execFile: execute,
    nodeExecutable: "/opt/homebrew/bin/node",
    cliPath: "/opt/homebrew/lib/node_modules/punchcard-presence/bin/cli.js",
  });
  assert.equal(installed.type, "launch-agent");
  assert.equal(installed.loaded, true);
  assert.ok(calls.some((call) => call[1] === "bootstrap" && call[2] === "gui/501"));
  if (process.platform !== "win32") assert.equal((await fs.stat(installed.location)).mode & 0o777, 0o600);

  const bootstraps = calls.filter((call) => call[1] === "bootstrap").length;
  await installAutostart({
    platform: "darwin",
    home,
    uid: 501,
    env: {},
    execFile: execute,
    nodeExecutable: "/opt/homebrew/bin/node",
    cliPath: "/opt/homebrew/lib/node_modules/punchcard-presence/bin/cli.js",
  });
  assert.equal(calls.filter((call) => call[1] === "bootstrap").length, bootstraps);

  await removeAutostart({ platform: "darwin", home, uid: 501, execFile: execute });
  await assert.rejects(fs.access(installed.location));
  assert.ok(calls.some((call) => call[1] === "disable" && call[2] === "gui/501/com.punchcard.presence"));
  assert.ok(calls.some((call) => call[1] === "bootout" && call[2] === "gui/501/com.punchcard.presence"));
});

test("macOS uses Application Support while preserving an existing legacy state directory", () => {
  const home = path.join(path.parse(process.cwd()).root, "Users", "punchcard-test");
  const native = path.join(home, "Library", "Application Support", "Punchcard");
  const legacy = path.join(home, ".claude-codex-presence");
  assert.equal(appPaths({}, { platform: "darwin", homeDirectory: home, existsSync: () => false }).home, native);
  assert.equal(appPaths({}, {
    platform: "darwin",
    homeDirectory: home,
    existsSync: (candidate) => candidate === legacy,
  }).home, legacy);
  assert.equal(appPaths({ PUNCHCARD_HOME: path.join(home, "custom") }, {
    platform: "darwin",
    homeDirectory: home,
    existsSync: () => false,
  }).home, path.join(home, "custom"));
});

test("Codex state discovery includes current app-managed and legacy database locations", () => {
  const home = path.join(path.parse(process.cwd()).root, "Users", "punchcard-test");
  const paths = appPaths({ CODEX_HOME: path.join(home, ".codex") }, {
    platform: "darwin",
    homeDirectory: home,
    existsSync: () => false,
  });
  assert.deepEqual(paths.codexStateCandidates, [
    path.join(home, ".codex", "sqlite", "state_5.sqlite"),
    path.join(home, ".codex", "state_5.sqlite"),
  ]);
});

test("Unix process parsing preserves macOS application paths with spaces", () => {
  const parsed = parseUnixProcessOutputs(
    " 10 1 /Applications/Claude.app/Contents/MacOS/Claude\n 20 1 /Users/me/.local/bin/claude\n",
    " 10 /Applications/Claude.app/Contents/MacOS/Claude --type=renderer\n 20 /Users/me/.local/bin/claude\n",
  );
  assert.equal(parsed[0].executable, "/Applications/Claude.app/Contents/MacOS/Claude");
  assert.equal(parsed[0].name, "Claude");
  assert.equal(parsed[1].command, "/Users/me/.local/bin/claude");
});

test("macOS process classification excludes desktop shells and counts terminal agents", () => {
  const result = summarizeProcesses([
    { pid: 10, ppid: 1, name: "Claude", executable: "/Applications/Claude.app/Contents/MacOS/Claude", command: "/Applications/Claude.app/Contents/MacOS/Claude" },
    { pid: 11, ppid: 1, name: "claude", executable: "/Users/me/.local/bin/claude", command: "/Users/me/.local/bin/claude" },
    { pid: 12, ppid: 1, name: "node", executable: "/opt/homebrew/bin/node", command: "/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js" },
    { pid: 20, ppid: 1, name: "Codex", executable: "/Applications/Codex.app/Contents/MacOS/Codex", command: "/Applications/Codex.app/Contents/MacOS/Codex" },
    { pid: 21, ppid: 1, name: "node", executable: "/opt/homebrew/bin/node", command: "/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js" },
  ]);
  assert.equal(result.claudeAgents, 2);
  assert.equal(result.codexCliAgents, 1);
});

test("npm discovery follows the documented Unix prefix layout used by Homebrew and version managers", async (t) => {
  const prefix = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-npm-prefix-"));
  t.after(() => fs.rm(prefix, { recursive: true, force: true }));
  const nodeExecutable = path.join(prefix, "bin", "node");
  const npmCli = path.join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  await fs.mkdir(path.dirname(npmCli), { recursive: true });
  await fs.writeFile(npmCli, "", "utf8");
  assert.equal(await findNpmCli({ env: {}, nodeExecutable }), npmCli);
});

test("macOS menu bar uses AppKit and absolute NSTask arguments without a shell", async () => {
  const [script, cli] = await Promise.all([
    fs.readFile(path.join(root, "scripts", "tray-macos.js"), "utf8"),
    fs.readFile(path.join(root, "bin", "cli.js"), "utf8"),
  ]);
  assert.match(script, /NSApplicationActivationPolicyAccessory/u);
  assert.match(script, /NSStatusBar\.systemStatusBar\.statusItemWithLength/u);
  assert.match(script, /punchcardMenu\.autoenablesItems = false/u);
  assert.match(script, /NSTask\.alloc\.init/u);
  assert.match(script, /task\.launchPath = punchcardNodePath/u);
  assert.match(script, /task\.arguments = \[punchcardCliPath\]\.concat\(arguments_\)/u);
  assert.match(script, /Show agent count/u);
  assert.match(script, /Show daily token usage/u);
  assert.match(script, /Show weekly token usage/u);
  assert.match(script, /\["update-check", "--current-version", punchcardVersion, "--json"\]/u);
  assert.match(script, /\["update", "--current-version", punchcardVersion, "--json"\]/u);
  assert.match(script, /now - lastAutomaticUpdateCheck >= 15 \* 60 \* 1000/u);
  assert.match(script, /launchPunchcard\(\["quit", "--from-tray"\], true\)/u);
  assert.doesNotMatch(script, /doShellScript|\/bin\/sh|zsh|bash/u);
  assert.match(cli, /process\.argv\.includes\("--login"\).*startDetached\(\)/u);
  assert.match(cli, /preserveTray = process\.platform === "darwin"/u);
  assert.doesNotMatch(cli, /Punchcard closed\. Start with Windows/u);
});
