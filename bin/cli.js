#!/usr/bin/env node
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appPaths } from "../lib/paths.js";
import { readPid, isPidAlive, readSettings, writeSettings, readStatus } from "../lib/state.js";
import { installAutostart, removeAutostart } from "../lib/autostart.js";
import { runDaemon } from "../lib/daemon.js";
import { LocalTelemetry } from "../lib/usage.js";
import { detectProcesses } from "../lib/processes.js";
import { buildPresence } from "../lib/activity.js";
import { addClaudeDesktopBackground, readClaudeActivity, recordClaudeHook, clearClaudeActivity } from "../lib/claude-activity.js";
import { installClaudeHooks, removeClaudeHooks } from "../lib/claude-hooks.js";
import { requestTrayExit, runTrayHost, runningTrayPid, startTrayDetached, stopTray } from "../lib/tray.js";
import { checkForUpdate, isValidVersion } from "../lib/updater.js";
import { findNpmCli } from "../lib/npm-cli.js";
import { platformSnapshot } from "../lib/platform.js";
import { normalizeProfileBaseUrl, profileSnapshot, profileStateUrl } from "../lib/profile.js";
import {
  installMoreMetrics,
  readMoreMetricsStatus,
  removeMoreMetrics,
  setProfileVisibility,
  writeMoreMetricsStatus,
} from "../lib/more-metrics.js";
import {
  appendPrivateDashboardError,
  openExternal,
  runPrivateDashboard,
  startPrivateDashboardDetached,
} from "../lib/private-dashboard.js";

const paths = appPaths();
const cliPath = fileURLToPath(import.meta.url);
const command = (process.argv[2] || "status").toLowerCase();
const json = process.argv.includes("--json");
const packageMetadata = JSON.parse(await fs.readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

function option(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function runningPid() {
  const pid = await readPid(paths);
  return isPidAlive(pid) ? pid : null;
}

async function startDetached(options = {}) {
  const existing = await runningPid();
  if (existing) return existing;
  const child = spawn(process.execPath, [cliPath, "run"], {
    cwd: paths.home,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      ...(Number.isFinite(options.presenceStartedAt)
        ? { PUNCHCARD_PRESENCE_STARTED_AT: String(options.presenceStartedAt) }
        : {}),
    },
  });
  child.unref();
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pid = await runningPid();
    if (pid) return pid;
  }
  return child.pid;
}

async function stopDaemon() {
  const pid = await runningPid();
  if (!pid) {
    await fs.rm(paths.pid, { force: true });
    return false;
  }
  try { process.kill(pid, "SIGTERM"); } catch { return false; }
  for (let i = 0; i < 30 && isPidAlive(pid); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!isPidAlive(pid)) await fs.rm(paths.pid, { force: true });
  return true;
}

async function openDiscordClient() {
  const commands = process.platform === "win32"
    ? [
        {
          executable: path.join(process.env.LOCALAPPDATA || "", "Discord", "Update.exe"),
          arguments: ["--processStart", "Discord.exe"],
          mustExist: true,
        },
        { executable: "explorer.exe", arguments: ["discord://"], mustExist: false },
      ]
    : process.platform === "darwin"
      ? [{ executable: "/usr/bin/open", arguments: ["discord://"], mustExist: true }]
      : [{ executable: "xdg-open", arguments: ["discord://"], mustExist: false }];
  for (const command of commands) {
    try {
      if (command.mustExist) await fs.access(command.executable);
      const child = spawn(command.executable, command.arguments, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", () => {});
      child.unref();
      return true;
    } catch {}
  }
  return false;
}

async function waitForDiscordConnection(pid, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const status = await readStatus(paths);
    if (status?.pid === pid && status.discordConnected === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  return false;
}

async function updateSnapshot() {
  const reportedVersion = option("current-version");
  const currentVersion = reportedVersion || packageMetadata.version;
  if (!isValidVersion(currentVersion)) {
    return {
      currentVersion: packageMetadata.version,
      latestVersion: null,
      updateAvailable: false,
      error: "Punchcard reported an invalid running version",
    };
  }
  return checkForUpdate({ packageName: packageMetadata.name, currentVersion });
}

async function writeUpdateStatus(status) {
  await fs.mkdir(paths.home, { recursive: true });
  await fs.writeFile(paths.updateStatus, `${JSON.stringify({ ...status, checkedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

async function runUpdateWorker(targetVersion) {
  if (!isValidVersion(targetVersion)) throw new Error("Refusing to install an invalid version");
  await writeUpdateStatus({ state: "installing", targetVersion, error: null });
  try {
    const npmCli = await findNpmCli();
    const child = spawn(process.execPath, [
      npmCli,
      "install",
      "-g",
      `${packageMetadata.name}@${targetVersion}`,
      "--no-audit",
      "--no-fund",
    ], { windowsHide: true, stdio: "ignore", env: process.env });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    if (exitCode !== 0) throw new Error(`npm install exited with code ${exitCode}`);
    await writeUpdateStatus({ state: "installed", targetVersion, error: null });
    const installer = spawn(process.execPath, [cliPath, "install", "--post-update"], {
      cwd: paths.home,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    });
    installer.unref();
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught);
    await writeUpdateStatus({ state: "failed", targetVersion, error });
    throw caught;
  }
}

function startUpdateWorker(targetVersion) {
  const child = spawn(process.execPath, [cliPath, "update-worker", "--version", targetVersion], {
    cwd: paths.home,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return child.pid;
}

function startMoreMetricsWorker(action) {
  const child = spawn(process.execPath, [cliPath, "more-metrics-worker", action], {
    cwd: paths.home,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return child.pid;
}

async function moreMetricsSnapshot() {
  const [settings, installStatus] = await Promise.all([
    readSettings(paths),
    readMoreMetricsStatus(paths),
  ]);
  return {
    enabled: settings.moreMetrics === true,
    pending: settings.moreMetricsPending === true,
    ...installStatus,
  };
}

async function statusSnapshot() {
  const [settings, pid, trayPid, saved, moreMetrics, system] = await Promise.all([
    readSettings(paths),
    runningPid(),
    runningTrayPid(paths),
    readStatus(paths),
    readMoreMetricsStatus(paths),
    platformSnapshot(paths),
  ]);
  const moreMetricsSnapshot = {
    enabled: settings.moreMetrics === true,
    pending: settings.moreMetricsPending === true,
    ...moreMetrics,
  };
  if (pid && saved) {
    return {
      version: packageMetadata.version,
      system,
      enabled: settings.enabled,
      running: true,
      trayRunning: Boolean(trayPid),
      trayPid,
      ...saved,
      profile: profileSnapshot(settings, saved),
      moreMetrics: moreMetricsSnapshot,
      display: {
        agentCount: settings.showAgentCount !== false,
        dailyTokens: settings.showDailyTokens !== false,
        weeklyTokens: settings.showWeeklyTokens !== false,
      },
      pid,
    };
  }
  const telemetry = new LocalTelemetry(paths);
  const [usage, detected, hookActivity] = await Promise.all([
    telemetry.refresh(),
    detectProcesses(),
    readClaudeActivity(paths),
  ]);
  const claude = addClaudeDesktopBackground(hookActivity, detected.claudeDesktopBackgroundAgents);
  const processes = { ...detected, claudeOpen: claude.activeAgents > 0, claudeAgents: claude.activeAgents };
  const activity = buildPresence(processes, usage, {
    showAgentCount: settings.showAgentCount,
    showDailyTokens: settings.showDailyTokens,
    showWeeklyTokens: settings.showWeeklyTokens,
    stateUrl: profileStateUrl(settings, saved || {}),
  });
  return {
    version: packageMetadata.version,
    system,
    enabled: settings.enabled,
    running: Boolean(pid),
    trayRunning: Boolean(trayPid),
    trayPid,
    pid,
    discordConnected: false,
    vendors: {
      claude: claude.activeAgents > 0,
      codex: (usage.codexActiveAgents || 0) > 0,
    },
    activeAgents: (processes.claudeAgents || 0) + (usage.codexActiveAgents || 0),
    tokensToday: usage,
    image: activity?.assets?.large_image || null,
    activity: activity ? { details: activity.details, state: activity.state } : null,
    claudeActivity: claude,
    clientId: settings.clientId,
    profile: profileSnapshot(settings, saved || {}),
    moreMetrics: moreMetricsSnapshot,
    display: {
      agentCount: settings.showAgentCount !== false,
      dailyTokens: settings.showDailyTokens !== false,
      weeklyTokens: settings.showWeeklyTokens !== false,
    },
    error: saved?.error || null,
  };
}

function printStatus(snapshot) {
  if (json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  console.log(`Punchcard v${snapshot.version || packageMetadata.version}: ${snapshot.enabled ? "on" : "off"}${snapshot.running ? ` (pid ${snapshot.pid})` : ""}`);
  console.log(`System: ${snapshot.system?.platform || process.platform} ${snapshot.system?.arch || process.arch}; ${snapshot.system?.interface || "unknown interface"}; ${snapshot.system?.node || process.version}`);
  if (snapshot.system?.macos) {
    const missing = Object.entries(snapshot.system.macos.tools).filter(([, tool]) => !tool.available).map(([name]) => name);
    console.log(`macOS prerequisites: ${missing.length ? `missing ${missing.join(", ")}` : "ready"}`);
    console.log(`LaunchAgent: ${snapshot.system.macos.launchAgent.available ? `installed (${snapshot.system.macos.launchAgent.mode}); ${snapshot.system.macos.launchAgent.loaded ? "loaded" : "not loaded"}` : "not installed"}`);
  }
  console.log(`Discord: ${snapshot.discordConnected ? "connected" : "not connected"}`);
  console.log(`Tray: ${snapshot.trayRunning ? `running (pid ${snapshot.trayPid})` : "not running"}`);
  console.log(`Detected: ${snapshot.vendors?.claude ? "Claude" : ""}${snapshot.vendors?.claude && snapshot.vendors?.codex ? " + " : ""}${snapshot.vendors?.codex ? "Codex" : ""}${!snapshot.vendors?.claude && !snapshot.vendors?.codex ? "none" : ""}`);
  console.log(`Active agents: ${snapshot.activeAgents ?? 0}`);
  if (snapshot.tokensToday) {
    console.log(`Codex agents: ${snapshot.tokensToday.codexActiveAgents ?? 0} (${snapshot.tokensToday.codexMainAgents ?? 0} main + ${snapshot.tokensToday.codexSubagents ?? 0} subagents)`);
  }
  console.log(`Tokens today: ${snapshot.tokensToday?.totalTokens ?? 0}`);
  console.log(`Tokens rolling week: ${snapshot.tokensToday?.totalTokensWeek ?? 0}`);
  if (snapshot.activity) console.log(`Presence: ${[snapshot.activity.details, snapshot.activity.state].filter(Boolean).join(" / ")}`);
  console.log(`Image: ${snapshot.image || "none"}`);
  if (snapshot.discordClientId || snapshot.clientId) console.log(`Discord app: ${snapshot.discordClientId || snapshot.clientId}`);
  console.log(`More Metrics: ${snapshot.moreMetrics?.enabled ? "on" : snapshot.moreMetrics?.pending ? "installing" : "off"}`);
  console.log(`Profile: ${snapshot.profile?.url || "not ready"}`);
  if (snapshot.error) console.log(`Last error: ${snapshot.error}`);
}

switch (command) {
  case "run":
    if (!(await runningPid())) await runDaemon();
    break;
  case "on":
  case "start": {
    await writeSettings({ enabled: true }, paths);
    await installClaudeHooks(paths);
    const settings = await readSettings(paths);
    const autostart = settings.startAtLogin ? await installAutostart() : { type: "disabled" };
    const pid = await startDetached();
    const trayPid = await startTrayDetached(paths);
    console.log(`Punchcard is on (daemon ${pid}; tray ${trayPid || "unsupported"}; ${autostart.type}).`);
    break;
  }
  case "install": {
    await writeSettings({ enabled: true }, paths);
    await stopDaemon();
    await stopTray(paths);
    await installClaudeHooks(paths);
    const settings = await readSettings(paths);
    const autostart = settings.startAtLogin ? await installAutostart() : { type: "disabled" };
    const pid = await startDetached();
    const trayPid = await startTrayDetached(paths, { showOnStart: true });
    if (!process.argv.includes("--postinstall")) console.log(`Punchcard is installed (daemon ${pid}; tray ${trayPid || "unsupported"}; ${autostart.type}).`);
    break;
  }
  case "off":
  case "stop":
  case "uninstall":
    await writeSettings({ enabled: false }, paths);
    await stopDaemon();
    await stopTray(paths);
    await removeAutostart();
    await removeClaudeHooks(paths);
    await clearClaudeActivity(paths);
    console.log("Punchcard is off.");
    break;
  case "quit": {
    await requestTrayExit(paths);
    await stopDaemon();
    if (!process.argv.includes("--from-tray")) await stopTray(paths);
    console.log("Punchcard closed. Start-at-login remains unchanged.");
    break;
  }
  case "toggle": {
    const settings = await readSettings(paths);
    if (settings.enabled && await runningPid()) {
      await writeSettings({ enabled: false }, paths);
      await stopDaemon();
      await stopTray(paths);
      await removeAutostart();
      await removeClaudeHooks(paths);
      await clearClaudeActivity(paths);
      console.log("Punchcard is off.");
    } else {
      await writeSettings({ enabled: true }, paths);
      await installClaudeHooks(paths);
      await installAutostart();
      const pid = await startDetached();
      const trayPid = await startTrayDetached(paths);
      console.log(`Punchcard is on (daemon ${pid}; tray ${trayPid || "unsupported"}).`);
    }
    break;
  }
  case "presence-on": {
    await writeSettings({ enabled: true }, paths);
    await installClaudeHooks(paths);
    const settings = await readSettings(paths);
    if (settings.startAtLogin) await installAutostart();
    console.log(`Punchcard presence enabled (pid ${await startDetached()}).`);
    break;
  }
  case "presence-off":
    await writeSettings({ enabled: false }, paths);
    await stopDaemon();
    console.log("Punchcard presence paused; the tray is still running.");
    break;
  case "connect":
  case "reconnect": {
    await writeSettings({ enabled: true }, paths);
    await installClaudeHooks(paths);
    const settings = await readSettings(paths);
    if (settings.startAtLogin) await installAutostart();
    const existingPid = await runningPid();
    const currentStatus = existingPid ? await readStatus(paths) : null;
    const carriedPresenceStartedAt = currentStatus?.pid === existingPid && currentStatus?.activity
      ? Date.parse(currentStatus.presenceStartedAt)
      : Number.NaN;
    await stopDaemon();
    const discordOpened = await openDiscordClient();
    const pid = await startDetached({ presenceStartedAt: carriedPresenceStartedAt });
    const connected = await waitForDiscordConnection(pid);
    const result = { connected, discordOpened, pid };
    if (json) console.log(JSON.stringify(result));
    else if (connected) console.log(`Discord connected through Punchcard (daemon ${pid}).`);
    else console.log(`Discord reconnect started through Punchcard (daemon ${pid}).`);
    break;
  }
  case "tray": {
    const settings = await readSettings(paths);
    if (settings.enabled) await startDetached();
    const trayPid = await startTrayDetached(paths, { showOnStart: process.argv.includes("--show") });
    if (!process.argv.includes("--quiet")) console.log(`Punchcard tray is running${trayPid ? ` (pid ${trayPid})` : ""}.`);
    break;
  }
  case "tray-host":
    if (process.argv.includes("--login") && (await readSettings(paths)).enabled) await startDetached();
    await runTrayHost(paths, { showOnStart: process.argv.includes("--show") });
    break;
  case "startup": {
    const enabled = String(process.argv[3] || "status").toLowerCase() === "on";
    if (String(process.argv[3] || "status").toLowerCase() !== "status") {
      await writeSettings({ startAtLogin: enabled }, paths);
      if (enabled) await installAutostart();
      else {
        const preserveTray = process.platform === "darwin" && Boolean(await runningTrayPid(paths));
        await removeAutostart();
        if (preserveTray) await startTrayDetached(paths);
      }
    }
    console.log(`Start at login: ${(await readSettings(paths)).startAtLogin ? "on" : "off"}`);
    break;
  }
  case "auto-update": {
    const requested = String(process.argv[3] || "status").toLowerCase();
    if (requested === "on" || requested === "off") await writeSettings({ autoUpdate: requested === "on" }, paths);
    console.log(`Automatic updates: ${(await readSettings(paths)).autoUpdate ? "on" : "off"}`);
    break;
  }
  case "display": {
    const field = String(process.argv[3] || "status").toLowerCase();
    const requested = String(process.argv[4] || "status").toLowerCase();
    const settingByField = {
      agents: "showAgentCount",
      daily: "showDailyTokens",
      weekly: "showWeeklyTokens",
    };
    if (field !== "status" && !Object.hasOwn(settingByField, field)) {
      console.error("Usage: punchcard display <agents|daily|weekly> <on|off|status>");
      process.exitCode = 1;
      break;
    }
    if (field !== "status" && requested !== "status" && requested !== "on" && requested !== "off") {
      console.error("Usage: punchcard display <agents|daily|weekly> <on|off|status>");
      process.exitCode = 1;
      break;
    }
    if (field !== "status" && requested !== "status") {
      await writeSettings({ [settingByField[field]]: requested === "on" }, paths);
    }
    const displaySettings = await readSettings(paths);
    const result = {
      agents: displaySettings.showAgentCount !== false,
      daily: displaySettings.showDailyTokens !== false,
      weekly: displaySettings.showWeeklyTokens !== false,
    };
    if (json) console.log(JSON.stringify(result));
    else if (field === "status") {
      console.log(`Discord display: agents ${result.agents ? "on" : "off"}; daily ${result.daily ? "on" : "off"}; weekly ${result.weekly ? "on" : "off"}`);
    } else {
      console.log(`${field[0].toUpperCase()}${field.slice(1)} display: ${result[field] ? "on" : "off"}`);
    }
    break;
  }
  case "profile": {
    const requestedBaseUrl = option("base-url");
    if (requestedBaseUrl) {
      const profileBaseUrl = normalizeProfileBaseUrl(requestedBaseUrl);
      if (!profileBaseUrl) {
        console.error("Profile base URL must be an http or https URL without credentials, query, or fragment.");
        process.exitCode = 1;
        break;
      }
      await writeSettings({ profileBaseUrl }, paths);
    }
    const [settings, saved] = await Promise.all([readSettings(paths), readStatus(paths)]);
    const profile = profileSnapshot(settings, saved || {});
    if (json) console.log(JSON.stringify(profile));
    else console.log(`Profile: ${profile.url || "not configured or waiting for Discord identity"}`);
    break;
  }
  case "profile-open": {
    const [settings, saved] = await Promise.all([readSettings(paths), readStatus(paths)]);
    const profile = profileSnapshot(settings, saved || {});
    if (settings.moreMetrics !== true || !profile.url) {
      const result = { opened: false, error: "Enable More Metrics and connect Discord first." };
      if (json) console.log(JSON.stringify(result));
      else console.error(result.error);
      process.exitCode = 1;
      break;
    }
    if (settings.showProfileInStatus === true) {
      const opened = openExternal(profile.url);
      const result = { opened, mode: "public", url: profile.url };
      if (json) console.log(JSON.stringify(result));
      else console.log(opened ? "Opened your public Punchcard profile." : `Public profile: ${profile.url}`);
    } else {
      const workerPid = startPrivateDashboardDetached({ cliPath, cwd: paths.home });
      const result = { opened: true, mode: "private", workerPid };
      if (json) console.log(JSON.stringify(result));
      else console.log(`Opening your private Punchcard insights locally (pid ${workerPid}).`);
    }
    break;
  }
  case "private-dashboard": {
    try {
      const [settings, saved] = await Promise.all([readSettings(paths), readStatus(paths)]);
      const profile = profileSnapshot(settings, saved || {});
      if (settings.moreMetrics !== true || !profile.username) throw new Error("Private insights are not ready yet");
      await runPrivateDashboard(paths, { username: profile.username, baseUrl: profile.baseUrl });
    } catch (error) {
      await appendPrivateDashboardError(paths, error);
      process.exitCode = 1;
    }
    break;
  }
  case "profile-link": {
    const requested = String(process.argv[3] || "status").toLowerCase();
    if (requested !== "on" && requested !== "off" && requested !== "status") {
      console.error("Usage: punchcard profile-link <on|off|status>");
      process.exitCode = 1;
      break;
    }
    const settings = await readSettings(paths);
    if (requested === "on" && settings.moreMetrics !== true) {
      console.error("Enable More Metrics before showing your profile in Discord.");
      process.exitCode = 1;
      break;
    }
    if (requested !== "status") {
      try {
        await setProfileVisibility(paths, requested === "on", { baseUrl: settings.profileBaseUrl });
        await writeSettings({ showProfileInStatus: requested === "on" }, paths);
      } catch (error) {
        const result = {
          available: true,
          enabled: settings.showProfileInStatus === true,
          error: error instanceof Error ? error.message : "Profile visibility could not be changed",
        };
        if (json) console.log(JSON.stringify(result));
        else console.error(result.error);
        process.exitCode = 1;
        break;
      }
    }
    const updated = await readSettings(paths);
    const result = {
      available: updated.moreMetrics === true,
      enabled: updated.moreMetrics === true && updated.showProfileInStatus === true,
    };
    if (json) console.log(JSON.stringify(result));
    else console.log(`Profile link in Discord: ${result.enabled ? "on" : "off"}`);
    break;
  }
  case "more-metrics": {
    const requested = String(process.argv[3] || "status").toLowerCase();
    if (requested === "status") {
      const snapshot = await moreMetricsSnapshot();
      if (json) console.log(JSON.stringify(snapshot));
      else console.log(`More Metrics: ${snapshot.enabled ? "on" : snapshot.pending ? snapshot.state : "off"}`);
      break;
    }
    if (requested !== "on" && requested !== "off") {
      console.error("Usage: punchcard more-metrics <on|off|status>");
      process.exitCode = 1;
      break;
    }
    const settings = await readSettings(paths);
    if (settings.moreMetricsPending) {
      const result = { started: false, pending: true, ...(await moreMetricsSnapshot()) };
      if (json) console.log(JSON.stringify(result));
      else console.log("More Metrics is already changing in the background.");
      break;
    }
    await writeSettings({
      moreMetricsPending: true,
      ...(requested === "off" ? { showProfileInStatus: false } : {}),
    }, paths);
    await writeMoreMetricsStatus(paths, { state: requested === "on" ? "queued-install" : "queued-remove" });
    const workerPid = startMoreMetricsWorker(requested);
    const result = { started: true, action: requested, workerPid };
    if (json) console.log(JSON.stringify(result));
    else console.log(`More Metrics ${requested === "on" ? "installation" : "removal"} started in the background.`);
    break;
  }
  case "more-metrics-worker": {
    const action = String(process.argv[3] || "").toLowerCase();
    try {
      if (action === "on") {
        await installMoreMetrics(paths);
        await writeSettings({ moreMetrics: true, moreMetricsPending: false }, paths);
      } else if (action === "off") {
        try {
          await setProfileVisibility(paths, false);
        } catch (error) {
          if (!String(error?.message || error).includes("not paired")) throw error;
        }
        await removeMoreMetrics(paths);
        await writeSettings({ moreMetrics: false, moreMetricsPending: false, showProfileInStatus: false }, paths);
      } else {
        throw new Error("Unknown More Metrics worker action");
      }
    } catch (error) {
      await writeSettings(action === "off"
        ? { moreMetrics: true, moreMetricsPending: false }
        : { moreMetrics: false, moreMetricsPending: false, showProfileInStatus: false }, paths);
      if ((await readMoreMetricsStatus(paths)).state !== "failed") {
        await writeMoreMetricsStatus(paths, {
          state: "failed",
          error: error instanceof Error ? error.message : "More Metrics failed",
        });
      }
      process.exitCode = 1;
    }
    break;
  }
  case "update-check": {
    const update = await updateSnapshot();
    await writeUpdateStatus({
      state: update.error ? "check-failed" : update.updateAvailable ? "available" : "current",
      targetVersion: update.latestVersion,
      currentVersion: update.currentVersion,
      error: update.error || null,
    });
    if (json) console.log(JSON.stringify(update));
    else if (update.error) console.log(`Update check unavailable: ${update.error}`);
    else if (update.updateAvailable) console.log(`Punchcard ${update.latestVersion} is available (current ${update.currentVersion}).`);
    else console.log(`Punchcard ${update.currentVersion} is up to date.`);
    break;
  }
  case "update":
  case "update-now": {
    const update = await updateSnapshot();
    if (update.error) {
      if (json) console.log(JSON.stringify({ updateStarted: false, ...update }));
      else console.error(`Update unavailable: ${update.error}`);
      process.exitCode = 1;
    } else if (!update.updateAvailable) {
      if (json) console.log(JSON.stringify({ updateStarted: false, ...update }));
      else console.log(`Punchcard ${update.currentVersion} is already current.`);
    } else {
      const workerPid = startUpdateWorker(update.latestVersion);
      const result = { updateStarted: true, workerPid, ...update };
      if (json) console.log(JSON.stringify(result));
      else console.log(`Updating Punchcard to ${update.latestVersion} in the background (pid ${workerPid}).`);
    }
    break;
  }
  case "update-worker": {
    try { await runUpdateWorker(option("version")); }
    catch { process.exitCode = 1; }
    break;
  }
  case "status":
  case "doctor":
    printStatus(await statusSnapshot());
    break;
  case "hook": {
    try { await recordClaudeHook(await readStdinJson(), paths); }
    catch { process.exitCode = 0; }
    break;
  }
  case "app":
  case "apps": {
    const settings = await readSettings(paths);
    const requested = option("id");
    if (requested) {
      await writeSettings({ clientId: String(requested) }, paths);
      if (await runningPid()) {
        await stopDaemon();
        await startDetached();
      }
      console.log("Punchcard Discord application ID updated.");
    }
    console.log(`Punchcard: ${requested || settings.clientId}`);
    break;
  }
  case "help":
  case "--help":
  case "-h":
    console.log("Usage: punchcard <on|off|quit|toggle|connect|status|doctor|restart|tray|startup|auto-update|display|more-metrics|profile|profile-open|profile-link|update-check|update|app>");
    console.log("       punchcard app --id ID");
    console.log("       punchcard display <agents|daily|weekly> <on|off|status>");
    console.log("       punchcard profile [--base-url URL]");
    console.log("       punchcard profile-link <on|off|status>");
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(packageMetadata.version);
    break;
  case "restart":
    await stopDaemon();
    await writeSettings({ enabled: true }, paths);
    await installClaudeHooks(paths);
    const settings = await readSettings(paths);
    if (settings.startAtLogin) await installAutostart();
    const pid = await startDetached();
    const trayPid = await startTrayDetached(paths);
    console.log(`Punchcard restarted (daemon ${pid}; tray ${trayPid || "unsupported"}).`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
}
