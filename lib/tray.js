import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appPaths } from "./paths.js";
import { isPidAlive, readPid, readSettings } from "./state.js";
import { appendBoundedLog } from "./logging.js";

const cliPath = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const trayScript = fileURLToPath(new URL("../scripts/tray.ps1", import.meta.url));
const macTrayScript = fileURLToPath(new URL("../scripts/tray-macos.js", import.meta.url));
const packageMetadata = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

function trayHostPidPath(paths) {
  return paths.trayHostPid || path.join(paths.home, "tray-host.pid");
}

function trayExitPath(paths) {
  return paths.trayExit || path.join(paths.home, "tray-exit");
}

async function readPidFile(file) {
  try {
    const value = Number.parseInt((await fs.readFile(file, "utf8")).trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readTrayPid(paths = appPaths()) {
  return readPidFile(paths.trayPid);
}

export async function runningTrayPid(paths = appPaths()) {
  const pid = await readTrayPid(paths);
  return isPidAlive(pid) ? pid : null;
}

export async function runningTrayHostPid(paths = appPaths()) {
  const pid = await readPidFile(trayHostPidPath(paths));
  return isPidAlive(pid) ? pid : null;
}

export async function requestTrayExit(paths = appPaths()) {
  await fs.mkdir(paths.home, { recursive: true });
  await fs.writeFile(trayExitPath(paths), `${Date.now()}\n`, "utf8");
}

async function trayExitRequested(paths) {
  try {
    await fs.access(trayExitPath(paths));
    return true;
  } catch {
    return false;
  }
}

export async function startTrayDetached(paths = appPaths(), options = {}) {
  if (process.platform !== "win32" && process.platform !== "darwin") return null;
  await fs.mkdir(paths.home, { recursive: true });
  await fs.rm(trayExitPath(paths), { force: true });
  const existing = await runningTrayPid(paths);
  if (existing) return existing;
  if (process.platform === "win32") {
    const existingHost = await runningTrayHostPid(paths);
    if (existingHost) {
      for (let i = 0; i < 30; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const pid = await runningTrayPid(paths);
        if (pid) return pid;
      }
      return existingHost;
    }
  }
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

async function claimPidFile(file) {
  const existing = await readPidFile(file);
  if (isPidAlive(existing)) return false;
  if (existing) await fs.rm(file, { force: true });
  try {
    await fs.writeFile(file, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return false;
  }
}

async function removeOwnedPid(file) {
  const saved = await readPidFile(file);
  if (saved === process.pid) await fs.rm(file, { force: true });
}

async function runMacTrayHost(paths) {
  if (!(await claimPidFile(paths.trayPid))) return;
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
    await removeOwnedPid(paths.trayPid);
  }
}

function startDaemonDetached(paths) {
  const child = spawn(process.execPath, [cliPath, "run"], {
    cwd: paths.home,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return child.pid;
}

async function ensureDaemonRunning(paths) {
  const settings = await readSettings(paths);
  if (settings.enabled === false) return null;
  const savedPid = await readPid(paths);
  if (isPidAlive(savedPid)) return savedPid;
  if (savedPid) await fs.rm(paths.pid, { force: true });
  const pid = startDaemonDetached(paths);
  await appendBoundedLog(paths.trayLog, `Presence daemon was not running; restarted it as pid ${pid}.`);
  return pid;
}

async function runWindowsTrayHost(paths, options) {
  const hostPidFile = trayHostPidPath(paths);
  if (!(await claimPidFile(hostPidFile))) return;
  let child = null;
  let stopping = false;
  const stop = () => {
    stopping = true;
    if (child && !child.killed) child.kill("SIGTERM");
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    while (!stopping && !(await trayExitRequested(paths))) {
      await ensureDaemonRunning(paths);
      child = spawn("powershell.exe", [
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
      const daemonTimer = setInterval(() => {
        ensureDaemonRunning(paths).catch((error) => appendBoundedLog(
          paths.trayLog,
          `Could not supervise the presence daemon: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }, 5000);
      const outcome = await new Promise((resolve) => {
        child.once("error", (error) => resolve({ error }));
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      clearInterval(daemonTimer);
      child = null;
      if (stopping || await trayExitRequested(paths)) break;
      const detail = outcome.error?.message || `exit ${outcome.code ?? outcome.signal ?? "unknown"}`;
      await appendBoundedLog(paths.trayLog, `Tray UI stopped unexpectedly (${detail}); restarting it.`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await removeOwnedPid(hostPidFile);
  }
}

export async function runTrayHost(paths = appPaths(), options = {}) {
  if (process.platform === "darwin") {
    await fs.mkdir(paths.home, { recursive: true });
    await runMacTrayHost(paths, options);
    return;
  }
  if (process.platform !== "win32") return;
  await fs.mkdir(paths.home, { recursive: true });
  await runWindowsTrayHost(paths, options);
}

export async function stopTray(paths = appPaths()) {
  await requestTrayExit(paths);
  const pid = await runningTrayPid(paths);
  const hostPid = process.platform === "win32" ? await runningTrayHostPid(paths) : null;
  if (pid) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  for (let i = 0; i < 30 && (isPidAlive(pid) || isPidAlive(hostPid)); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!isPidAlive(pid)) await fs.rm(paths.trayPid, { force: true });
  if (!isPidAlive(hostPid)) await fs.rm(trayHostPidPath(paths), { force: true });
  return Boolean(pid || hostPid) && !isPidAlive(pid) && !isPidAlive(hostPid);
}
