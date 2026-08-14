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

function xmlEscape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function installAutostart() {
  if (process.env.CLAUDE_CODEX_PRESENCE_NO_AUTOSTART === "1") return { type: "disabled-by-env" };
  if (process.platform === "win32") {
    const command = `"${process.execPath}" "${cliPath}" tray`;
    for (const legacyRunName of legacyRunNames) {
      try { await execFileAsync("reg.exe", ["DELETE", runKey, "/v", legacyRunName, "/f"], { windowsHide: true }); } catch {}
    }
    await execFileAsync("reg.exe", ["ADD", runKey, "/v", runName, "/t", "REG_SZ", "/d", command, "/f"], { windowsHide: true });
    return { type: "registry", location: `${runKey}\\${runName}` };
  }
  if (process.platform === "darwin") {
    const target = path.join(os.homedir(), "Library", "LaunchAgents", "com.punchcard.presence.plist");
    await fs.mkdir(path.dirname(target), { recursive: true });
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.punchcard.presence</string><key>ProgramArguments</key><array><string>${xmlEscape(process.execPath)}</string><string>${xmlEscape(cliPath)}</string><string>run</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\n`;
    await fs.writeFile(target, plist, "utf8");
    return { type: "launch-agent", location: target };
  }
  const target = path.join(os.homedir(), ".config", "autostart", "punchcard.desktop");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const quote = (value) => `"${String(value).replaceAll('"', '\\"')}"`;
  const desktop = `[Desktop Entry]\nType=Application\nName=Punchcard\nExec=${quote(process.execPath)} ${quote(cliPath)} run\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
  await fs.writeFile(target, desktop, "utf8");
  return { type: "desktop-entry", location: target };
}

export async function removeAutostart() {
  if (process.platform === "win32") {
    try { await execFileAsync("reg.exe", ["DELETE", runKey, "/v", runName, "/f"], { windowsHide: true }); } catch {}
    for (const legacyRunName of legacyRunNames) {
      try { await execFileAsync("reg.exe", ["DELETE", runKey, "/v", legacyRunName, "/f"], { windowsHide: true }); } catch {}
    }
    return;
  }
  const targets = process.platform === "darwin"
    ? ["com.punchcard.presence.plist", "com.claude-codex-presence.plist"].map((name) => path.join(os.homedir(), "Library", "LaunchAgents", name))
    : ["punchcard.desktop", "claude-codex-presence.desktop"].map((name) => path.join(os.homedir(), ".config", "autostart", name));
  await Promise.all(targets.map((target) => fs.rm(target, { force: true })));
}
