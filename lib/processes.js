import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeProcess(item) {
  return {
    pid: Number(item.ProcessId ?? item.pid),
    ppid: Number(item.ParentProcessId ?? item.ppid),
    name: String(item.Name ?? item.name ?? item.comm ?? ""),
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
    if (!name.includes("claude")) return false;
    if (/\bremote-control\b/.test(command)) return false;
    if (command.includes("--print") && command.includes("--sdk-url")) return false;
    if (command.includes("--type=") || command.includes("chrome-native-host")) return false;
    if (executable.includes("windowsapps\\claude_") || executable.includes("/applications/claude.app/")) return false;
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

  const codexCandidates = processes.filter((item) => item.name.toLowerCase() === "codex" || item.name.toLowerCase() === "codex.exe");
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

async function unixProcesses() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,comm=,args="], {
    timeout: 8_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), comm: match[3], args: match[4] }] : [];
  });
}

export async function detectProcesses() {
  try {
    const items = process.platform === "win32" ? await windowsProcesses() : await unixProcesses();
    return summarizeProcesses(items);
  } catch (error) {
    return { claudeOpen: false, claudeAgents: 0, claudeDesktopBackgroundAgents: 0, claudeRemoteControls: 0, codexOpen: false, codexCliAgents: 0, error: error.message };
  }
}
