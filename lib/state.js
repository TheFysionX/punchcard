import fs from "node:fs/promises";
import { DEFAULT_CLIENT_ID } from "./constants.js";
import { appPaths } from "./paths.js";

export async function ensureHome(paths = appPaths()) {
  await fs.mkdir(paths.home, { recursive: true });
}

export async function readSettings(paths = appPaths()) {
  const defaults = {
    enabled: true,
    startAtLogin: true,
    autoUpdate: false,
    showAgentCount: true,
    showDailyTokens: true,
    showWeeklyTokens: true,
    moreMetrics: false,
    moreMetricsPending: false,
    profileBaseUrl: null,
    clientId: DEFAULT_CLIENT_ID,
  };
  try {
    const parsed = JSON.parse(await fs.readFile(paths.settings, "utf8"));
    const fallback = String(parsed.clientId || defaults.clientId);
    const {
      clientIds: _discardedClientIds,
      profileUsername: _discardedProfileUsername,
      ...current
    } = parsed;
    return { ...defaults, ...current, clientId: fallback };
  } catch {
    return defaults;
  }
}

export async function writeSettings(settings, paths = appPaths()) {
  await ensureHome(paths);
  const current = await readSettings(paths);
  const next = { ...current, ...settings };
  await fs.writeFile(paths.settings, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function readPid(paths = appPaths()) {
  try {
    const value = Number.parseInt((await fs.readFile(paths.pid, "utf8")).trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function writeStatus(status, paths = appPaths()) {
  await ensureHome(paths);
  await fs.writeFile(paths.status, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function readStatus(paths = appPaths()) {
  try {
    return JSON.parse(await fs.readFile(paths.status, "utf8"));
  } catch {
    return null;
  }
}
