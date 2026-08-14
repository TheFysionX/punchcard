import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appPaths } from "./paths.js";
import { isPidAlive } from "./state.js";
import { appendBoundedLog } from "./logging.js";

const cliPath = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const trayScript = fileURLToPath(new URL("../scripts/tray.ps1", import.meta.url));
const macTrayScript = fileURLToPath(new URL("../scripts/tray-macos.js", import.meta.url));
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
  if (process.platform !== "win32" && process.platform !== "darwin") return null;
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

async function claimTrayHost(paths) {
  const existing = await readTrayPid(paths);
  if (isPidAlive(existing)) return false;
  if (existing) await fs.rm(paths.trayPid, { force: true });
  try {
    await fs.writeFile(paths.trayPid, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return false;
  }
}

async function removeOwnedTrayPid(paths) {
  const saved = await readTrayPid(paths);
  if (saved === process.pid) await fs.rm(paths.trayPid, { force: true });
}

async function runMacTrayHost(paths) {
  if (!(await claimTrayHost(paths))) return;
  let stopping = false;
  let stderr = "";
  const child = spawn("/usr/bin/osascript", [
    "-l", "JavaScript",
    macTrayScript,
    process.execPath,
    cliPath,
    paths.status,
    paths.settings,
    paths.moreMetricsStatus,
    paths.updateStatus,
    packageMetadata.version,
  ], {
    cwd: paths.home,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    env: process.env,
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16 * 1024);
  });
  const stop = () => {
    stopping = true;
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const outcome = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (!stopping && outcome.code !== 0) {
      const detail = stderr.trim() || `osascript exited with ${outcome.code ?? outcome.signal}`;
      throw new Error(detail);
    }
  } catch (error) {
    await appendBoundedLog(paths.trayLog, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await removeOwnedTrayPid(paths);
  }
}

export async function runTrayHost(paths = appPaths(), options = {}) {
  if (process.platform === "darwin") {
    await fs.mkdir(paths.home, { recursive: true });
    await runMacTrayHost(paths, options);
    return;
  }
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
