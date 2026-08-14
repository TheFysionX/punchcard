import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const runName = "Punchcard";
const legacyRunNames = ["CodeSense", "ClaudeCodexPresence"];
export const LAUNCH_AGENT_LABEL = "com.punchcard.presence";
const legacyLaunchAgentLabels = ["com.claude-codex-presence"];

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function launchAgentPlist(options = {}) {
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const commandPath = options.cliPath || cliPath;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodeExecutable)}</string>
    <string>${xmlEscape(commandPath)}</string>
    <string>tray-host</string>
    <string>--login</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>/dev/null</string>
</dict>
</plist>
`;
}

function darwinContext(options = {}) {
  const home = options.home || os.homedir();
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  if (!Number.isInteger(uid) || uid < 0) throw new Error("Punchcard could not determine the macOS user ID");
  const directory = path.join(home, "Library", "LaunchAgents");
  return {
    directory,
    uid,
    domain: `gui/${uid}`,
    service: `gui/${uid}/${LAUNCH_AGENT_LABEL}`,
    target: path.join(directory, `${LAUNCH_AGENT_LABEL}.plist`),
  };
}

async function launchctl(arguments_, options = {}) {
  const execute = options.execFile || execFileAsync;
  return execute("/bin/launchctl", arguments_, { timeout: 8_000, windowsHide: true });
}

async function isLaunchAgentLoaded(context, options = {}) {
  try {
    await launchctl(["print", context.service], options);
    return true;
  } catch {
    return false;
  }
}

export async function launchAgentRuntimeStatus(options = {}) {
  if ((options.platform || process.platform) !== "darwin") return null;
  const context = darwinContext(options);
  return {
    service: context.service,
    loaded: await isLaunchAgentLoaded(context, options),
  };
}

async function removeDarwinJob(label, filePath, context, options = {}) {
  const service = `${context.domain}/${label}`;
  try { await launchctl(["disable", service], options); } catch {}
  try { await launchctl(["bootout", service], options); } catch {}
  try { await launchctl(["bootout", context.domain, filePath], options); } catch {}
  await fs.rm(filePath, { force: true });
}

export async function installAutostart(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  if (env.CLAUDE_CODEX_PRESENCE_NO_AUTOSTART === "1") return { type: "disabled-by-env" };
  if (platform === "win32") {
    const execute = options.execFile || execFileAsync;
    const command = `"${options.nodeExecutable || process.execPath}" "${options.cliPath || cliPath}" tray`;
    for (const legacyRunName of legacyRunNames) {
      try { await execute("reg.exe", ["DELETE", runKey, "/v", legacyRunName, "/f"], { windowsHide: true }); } catch {}
    }
    await execute("reg.exe", ["ADD", runKey, "/v", runName, "/t", "REG_SZ", "/d", command, "/f"], { windowsHide: true });
    return { type: "registry", location: `${runKey}\\${runName}` };
  }
  if (platform === "darwin") {
    const context = darwinContext(options);
    await fs.mkdir(context.directory, { recursive: true });
    for (const label of legacyLaunchAgentLabels) {
      await removeDarwinJob(label, path.join(context.directory, `${label}.plist`), context, options);
    }

    const next = launchAgentPlist(options);
    const previous = await fs.readFile(context.target, "utf8").catch(() => null);
    const changed = previous !== next;
    if (changed) await fs.writeFile(context.target, next, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(context.target, 0o600);

    let loaded = await isLaunchAgentLoaded(context, options);
    let launchError = null;
    if (loaded && changed) {
      try {
        await launchctl(["bootout", context.service], options);
      } catch (error) {
        launchError = error instanceof Error ? error.message : String(error);
      }
      loaded = await isLaunchAgentLoaded(context, options);
      if (loaded) {
        return {
          type: "launch-agent",
          location: context.target,
          loaded: true,
          current: false,
          error: launchError || "The existing LaunchAgent could not be reloaded",
        };
      }
    }
    try { await launchctl(["enable", context.service], options); } catch {}
    if (!loaded) {
      try {
        await launchctl(["bootstrap", context.domain, context.target], options);
      } catch (error) {
        launchError = error instanceof Error ? error.message : String(error);
      }
      loaded = await isLaunchAgentLoaded(context, options);
    }
    return {
      type: "launch-agent",
      location: context.target,
      loaded,
      current: loaded,
      ...(loaded || !launchError ? {} : { error: launchError }),
    };
  }
  const home = options.home || os.homedir();
  const target = path.join(home, ".config", "autostart", "punchcard.desktop");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const quote = (value) => `"${String(value).replaceAll('"', '\\"')}"`;
  const desktop = `[Desktop Entry]\nType=Application\nName=Punchcard\nExec=${quote(options.nodeExecutable || process.execPath)} ${quote(options.cliPath || cliPath)} run\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
  await fs.writeFile(target, desktop, "utf8");
  return { type: "desktop-entry", location: target };
}

export async function removeAutostart(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === "win32") {
    const execute = options.execFile || execFileAsync;
    try { await execute("reg.exe", ["DELETE", runKey, "/v", runName, "/f"], { windowsHide: true }); } catch {}
    for (const legacyRunName of legacyRunNames) {
      try { await execute("reg.exe", ["DELETE", runKey, "/v", legacyRunName, "/f"], { windowsHide: true }); } catch {}
    }
    return;
  }
  const home = options.home || os.homedir();
  if (platform === "darwin") {
    const context = darwinContext(options);
    await removeDarwinJob(LAUNCH_AGENT_LABEL, context.target, context, options);
    for (const label of legacyLaunchAgentLabels) {
      await removeDarwinJob(label, path.join(context.directory, `${label}.plist`), context, options);
    }
    return;
  }
  const targets = ["punchcard.desktop", "claude-codex-presence.desktop"]
    .map((name) => path.join(home, ".config", "autostart", name));
  await Promise.all(targets.map((target) => fs.rm(target, { force: true })));
}
