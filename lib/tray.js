import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appPaths } from "./paths.js";
import { isPidAlive } from "./state.js";

const cliPath = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const trayScript = fileURLToPath(new URL("../scripts/tray.ps1", import.meta.url));
const packageMetadata = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

async function readTrayPid(paths = appPaths()) {
  try {
    const value = Number.parseInt((await fs.readFile(paths.trayPid, "utf8")).trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function runningTrayPid(paths = appPaths()) {
  const pid = await readTrayPid(paths);
  return isPidAlive(pid) ? pid : null;
}

export async function startTrayDetached(paths = appPaths(), options = {}) {
  if (process.platform !== "win32") return null;
  const existing = await runningTrayPid(paths);
  if (existing) return existing;
  await fs.mkdir(paths.home, { recursive: true });
  const child = spawn(process.execPath, [cliPath, "tray-host", ...(options.showOnStart ? ["--show"] : [])], {
    cwd: paths.home,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pid = await runningTrayPid(paths);
    if (pid) return pid;
  }
  return child.pid;
}

export async function runTrayHost(paths = appPaths(), options = {}) {
  if (process.platform !== "win32") return;
  const existing = await runningTrayPid(paths);
  if (existing) return;
  await fs.mkdir(paths.home, { recursive: true });
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", trayScript,
    "-NodePath", process.execPath,
    "-CliPath", cliPath,
    "-StatusPath", paths.status,
    "-SettingsPath", paths.settings,
    "-MoreMetricsStatusPath", paths.moreMetricsStatus,
    "-TrayPidPath", paths.trayPid,
    "-LogPath", paths.trayLog,
    "-CurrentVersion", packageMetadata.version,
    ...(options.showOnStart ? ["-ShowOnStart"] : []),
  ], {
    cwd: paths.home,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  await new Promise((resolve) => child.once("exit", resolve));
}

export async function stopTray(paths = appPaths()) {
  const pid = await runningTrayPid(paths);
  if (!pid) {
    await fs.rm(paths.trayPid, { force: true });
    return false;
  }
  try { process.kill(pid, "SIGTERM"); } catch { return false; }
  for (let i = 0; i < 30 && isPidAlive(pid); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!isPidAlive(pid)) await fs.rm(paths.trayPid, { force: true });
  return !isPidAlive(pid);
}
