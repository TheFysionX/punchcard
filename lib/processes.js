import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeProcess(item) {
  const rawName = String(item.Name ?? item.name ?? item.comm ?? "");
  return {
    pid: Number(item.ProcessId ?? item.pid),
    ppid: Number(item.ParentProcessId ?? item.ppid),
    name: path.basename(rawName.replaceAll("\\", "/")),
    executable: String(item.ExecutablePath ?? item.executable ?? ""),
    command: String(item.CommandLine ?? item.command ?? item.args ?? ""),
  };
}

export function summarizeProcesses(items) {
  const processes = items.map(normalizeProcess).filter((item) => Number.isFinite(item.pid));
  const childrenByParent = new Map();
  for (const process of processes) {
    const children = childrenByParent.get(process.ppid) || [];
    children.push(process);
    childrenByParent.set(process.ppid, children);
  }
  const claudeCandidates = processes.filter((item) => {
    const name = item.name.toLowerCase();
    const command = item.command.toLowerCase();
    const executable = item.executable.toLowerCase();
    const claudeCommand = /(?:^|[\\/\s])claude(?:\.exe)?(?:\s|$)/u.test(command)
      || /@anthropic-ai[\\/]claude-code[\\/]/u.test(command)
      || /[\\/]\.claude[\\/]local[\\/]/u.test(command);
    if (!name.includes("claude") && !claudeCommand) return false;
    if (/\bremote-control\b/.test(command)) return false;
    if (command.includes("--print") && command.includes("--sdk-url")) return false;
    if (command.includes("--type=") || command.includes("chrome-native-host")) return false;
    if (executable.includes("windowsapps\\claude_")
      || executable.includes("/applications/claude.app/")
      || command.includes("/applications/claude.app/")) return false;
    return true;
  });
  const claudePids = new Set(claudeCandidates.map((item) => item.pid));
  const claudeRoots = claudeCandidates.filter((item) => !claudePids.has(item.ppid));
  const claudeAgents = claudeRoots.length;
  const claudeDesktopBackgroundAgents = claudeRoots.filter((item) => {
    const command = item.command.toLowerCase();
    const embeddedDesktopAgent = command.includes("--permission-prompt-tool")
      && command.includes("--input-format stream-json");
    if (!embeddedDesktopAgent) return false;
    return (childrenByParent.get(item.pid) || []).some((child) => {
      const childName = child.name.toLowerCase();
      const childCommand = child.command.toLowerCase();
      if (childName === "conhost.exe" || childName === "conhost") return false;
      if (childCommand.includes("mcp") || childCommand.includes("model-context-protocol")) return false;
      return true;
    });
  }).length;

  const codexDesktopProcesses = processes.filter((item) => {
    const name = item.name.toLowerCase();
    const executable = item.executable.toLowerCase().replaceAll("\\", "/");
    const command = item.command.toLowerCase().replaceAll("\\", "/");
    const isDesktop = (name === "chatgpt.exe" && executable.includes("/windowsapps/openai.codex_"))
      || (name === "codex" && (executable.includes("/applications/codex.app/")
        || command.includes("/applications/codex.app/")));
    return isDesktop && !command.includes("--type=");
  });
  const codexDesktopOpen = codexDesktopProcesses.length > 0;
  const codexDesktopPids = codexDesktopProcesses.map((item) => item.pid);

  const codexCandidates = processes.filter((item) => {
    const name = item.name.toLowerCase();
    const command = item.command.toLowerCase();
    const executable = item.executable.toLowerCase();
    const codexCommand = /@openai[\\/]codex[\\/]bin[\\/]codex\.js/u.test(command);
    if (name !== "codex" && name !== "codex.exe" && !codexCommand) return false;
    return !executable.includes("/applications/codex.app/") && !command.includes("/applications/codex.app/");
  });
  const codexCliCandidates = codexCandidates.filter((item) => {
    const command = item.command.toLowerCase();
    return !command.includes("app-server") && !command.includes("mcp-server") && !command.includes("--help") && !command.includes("--version");
  });
  const codexCliPids = new Set(codexCliCandidates.map((item) => item.pid));
  const codexCliAgents = codexCliCandidates.filter((item) => !codexCliPids.has(item.ppid)).length;

  return {
    claudeOpen: claudeCandidates.length > 0,
    claudeAgents,
    claudeDesktopBackgroundAgents,
    claudeRemoteControls: processes.filter((item) => /\bremote-control\b/i.test(item.command)).length,
    codexOpen: codexCandidates.length > 0,
    codexDesktopOpen,
    codexDesktopPids,
    codexCliAgents,
  };
}

async function windowsProcesses() {
  const script = [
    "$items = Get-CimInstance Win32_Process |",
    "Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CommandLine;",
    "if ($items) { $items | ConvertTo-Json -Compress } else { '[]' }",
  ].join(" ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    timeout: 8_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout.trim() || "[]");
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function parseUnixProcessOutputs(identityOutput, argumentOutput) {
  const byPid = new Map();
  for (const line of identityOutput.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/u);
    if (!match) continue;
    const executable = match[3].trim();
    byPid.set(Number(match[1]), {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      name: path.basename(executable),
      executable,
      command: "",
    });
  }
  for (const line of argumentOutput.split("\n")) {
    const match = line.trim().match(/^(\d+)\s*(.*)$/u);
    if (!match) continue;
    const item = byPid.get(Number(match[1]));
    if (item) item.command = match[2];
  }
  return [...byPid.values()];
}

async function unixProcesses() {
  const executable = process.platform === "darwin" ? "/bin/ps" : "ps";
  const options = {
    timeout: 8_000,
    maxBuffer: 8 * 1024 * 1024,
  };
  const [identities, arguments_] = await Promise.all([
    execFileAsync(executable, ["-axo", "pid=,ppid=,comm="], options),
    execFileAsync(executable, ["-axo", "pid=,args="], options),
  ]);
  return parseUnixProcessOutputs(identities.stdout, arguments_.stdout);
}

export async function detectProcesses() {
  try {
    const items = process.platform === "win32" ? await windowsProcesses() : await unixProcesses();
    return summarizeProcesses(items);
  } catch (error) {
    return { claudeOpen: false, claudeAgents: 0, claudeDesktopBackgroundAgents: 0, claudeRemoteControls: 0, codexOpen: false, codexDesktopOpen: false, codexDesktopPids: [], codexCliAgents: 0, error: error.message };
  }
}
