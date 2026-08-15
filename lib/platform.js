import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LAUNCH_AGENT_LABEL, launchAgentRuntimeStatus } from "./autostart.js";
import { appPaths } from "./paths.js";

async function fileState(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return { available: stat.isFile(), mode: `0${(stat.mode & 0o777).toString(8)}` };
  } catch {
    return { available: false, mode: null };
  }
}

export async function platformSnapshot(paths = appPaths(), options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || os.homedir();
  const base = {
    platform,
    arch: options.arch || process.arch,
    node: options.nodeVersion || process.version,
    interface: platform === "win32" ? "windows-tray" : platform === "darwin" ? "macos-menu-bar" : "headless",
    stateHome: paths.home,
  };
  if (platform !== "darwin") return base;

  const launchAgent = path.join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
  const tools = {
    osascript: "/usr/bin/osascript",
    launchctl: "/bin/launchctl",
    open: "/usr/bin/open",
    ps: "/bin/ps",
  };
  const checkedTools = Object.fromEntries(await Promise.all(Object.entries(tools).map(async ([name, filePath]) => {
    const state = await fileState(filePath);
    return [name, { path: filePath, available: state.available }];
  })));
  const runtime = await launchAgentRuntimeStatus({ platform: "darwin", home, uid: options.uid, execFile: options.execFile });
  return {
    ...base,
    macos: {
      ready: Object.values(checkedTools).every((tool) => tool.available),
      tools: checkedTools,
      launchAgent: { path: launchAgent, ...await fileState(launchAgent), loaded: runtime.loaded, service: runtime.service },
      finalVerificationRequired: true,
    },
  };
}
