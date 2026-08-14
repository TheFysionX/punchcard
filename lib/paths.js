import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function appPaths(env = process.env, options = {}) {
  const homeDirectory = options.homeDirectory || os.homedir();
  const platform = options.platform || process.platform;
  const exists = options.existsSync || fs.existsSync;
  const legacyHome = path.join(homeDirectory, ".claude-codex-presence");
  const macHome = path.join(homeDirectory, "Library", "Application Support", "Punchcard");
  const explicitHome = env.PUNCHCARD_HOME || env.CLAUDE_CODEX_PRESENCE_HOME;
  const home = explicitHome || (platform === "darwin" && (exists(macHome) || !exists(legacyHome)) ? macHome : legacyHome);
  const codexHome = env.CODEX_HOME || path.join(homeDirectory, ".codex");
  const codexState = path.join(codexHome, "state_5.sqlite");
  const codexStateCandidates = [...new Set([
    env.CODEX_SQLITE_HOME ? path.join(env.CODEX_SQLITE_HOME, "state_5.sqlite") : null,
    path.join(codexHome, "sqlite", "state_5.sqlite"),
    codexState,
  ].filter(Boolean))];
  const moreMetricsRoot = path.join(home, "extensions", "more-metrics");
  return {
    home,
    legacyHome,
    settings: path.join(home, "settings.json"),
    pid: path.join(home, "daemon.pid"),
    trayPid: path.join(home, "tray.pid"),
    trayLog: path.join(home, "tray.log"),
    updateStatus: path.join(home, "update-status.json"),
    moreMetricsRoot,
    moreMetricsStatus: path.join(home, "more-metrics-status.json"),
    privateDashboardLog: path.join(home, "private-dashboard.log"),
    status: path.join(home, "status.json"),
    log: path.join(home, "daemon.log"),
    claudeActivity: path.join(home, "claude-activity"),
    claudeSettings: env.CLAUDE_CONFIG_DIR
      ? path.join(env.CLAUDE_CONFIG_DIR, "settings.json")
      : path.join(homeDirectory, ".claude", "settings.json"),
    codexSessions: path.join(codexHome, "sessions"),
    codexState,
    codexStateCandidates,
    codexGlobalState: path.join(codexHome, ".codex-global-state.json"),
    claudeProjects: env.CLAUDE_CONFIG_DIR
      ? path.join(env.CLAUDE_CONFIG_DIR, "projects")
      : path.join(homeDirectory, ".claude", "projects"),
  };
}
