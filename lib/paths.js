import os from "node:os";
import path from "node:path";

export function appPaths(env = process.env) {
  const home = env.CLAUDE_CODEX_PRESENCE_HOME || path.join(os.homedir(), ".claude-codex-presence");
  const codexHome = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const moreMetricsRoot = path.join(home, "extensions", "more-metrics");
  return {
    home,
    settings: path.join(home, "settings.json"),
    pid: path.join(home, "daemon.pid"),
    trayPid: path.join(home, "tray.pid"),
    trayLog: path.join(home, "tray.log"),
    updateStatus: path.join(home, "update-status.json"),
    moreMetricsRoot,
    moreMetricsStatus: path.join(home, "more-metrics-status.json"),
    status: path.join(home, "status.json"),
    log: path.join(home, "daemon.log"),
    claudeActivity: path.join(home, "claude-activity"),
    claudeSettings: env.CLAUDE_CONFIG_DIR
      ? path.join(env.CLAUDE_CONFIG_DIR, "settings.json")
      : path.join(os.homedir(), ".claude", "settings.json"),
    codexSessions: path.join(codexHome, "sessions"),
    codexState: path.join(codexHome, "state_5.sqlite"),
    claudeProjects: env.CLAUDE_CONFIG_DIR
      ? path.join(env.CLAUDE_CONFIG_DIR, "projects")
      : path.join(os.homedir(), ".claude", "projects"),
  };
}
