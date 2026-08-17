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
  const configuredCodexLogs = env.PUNCHCARD_CODEX_DESKTOP_LOGS
    ? env.PUNCHCARD_CODEX_DESKTOP_LOGS.split(path.delimiter).filter(Boolean)
    : null;
  const localAppData = env.LOCALAPPDATA || path.join(homeDirectory, "AppData", "Local");
  const codexDesktopLogs = configuredCodexLogs || (platform === "win32"
    ? [
        path.join(localAppData, "Packages", "OpenAI.Codex_2p2nqsd0c76g0", "LocalCache", "Local", "Codex", "Logs"),
        path.join(localAppData, "Codex", "Logs"),
      ]
    : platform === "darwin"
      ? [path.join(homeDirectory, "Library", "Logs", "Codex")]
      : [path.join(homeDirectory, ".config", "Codex", "logs")]);
  const moreMetricsRoot = path.join(home, "extensions", "more-metrics");
  return {
    home,
    legacyHome,
    settings: path.join(home, "settings.json"),
    pid: path.join(home, "daemon.pid"),
    trayPid: path.join(home, "tray.pid"),
    trayHostPid: path.join(home, "tray-host.pid"),
    trayExit: path.join(home, "tray-exit"),
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
    codexDesktopLogs,
    claudeProjects: env.CLAUDE_CONFIG_DIR
      ? path.join(env.CLAUDE_CONFIG_DIR, "projects")
      : path.join(homeDirectory, ".claude", "projects"),
  };
}
