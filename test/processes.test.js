import test from "node:test";
import assert from "node:assert/strict";
import { summarizeProcesses } from "../lib/processes.js";

test("ignores remote-control listeners and does not double-count print children", () => {
  const result = summarizeProcesses([
    { Name: "claude.exe", ProcessId: 10, ParentProcessId: 1, ExecutablePath: "C:\\npm\\claude.exe", CommandLine: "claude remote-control" },
    { Name: "claude.exe", ProcessId: 11, ParentProcessId: 10, ExecutablePath: "C:\\npm\\claude.exe", CommandLine: "claude --print --sdk-url https://api.anthropic.com/v1/code/sessions/test" },
    { Name: "claude.exe", ProcessId: 12, ParentProcessId: 1, ExecutablePath: "C:\\npm\\claude.exe", CommandLine: "claude" },
  ]);
  assert.equal(result.claudeAgents, 1);
  assert.equal(result.claudeRemoteControls, 1);
});

test("ignores Claude desktop Electron helpers", () => {
  const result = summarizeProcesses([
    { Name: "claude.exe", ProcessId: 10, ParentProcessId: 1, ExecutablePath: "C:\\Program Files\\WindowsApps\\Claude_1\\claude.exe", CommandLine: "claude.exe --type=renderer" },
  ]);
  assert.equal(result.claudeOpen, false);
});

test("counts a Claude Desktop agent only while a real background child is running", () => {
  const result = summarizeProcesses([
    { Name: "claude.exe", ProcessId: 10, ParentProcessId: 1, ExecutablePath: "C:\\Claude\\claude-code\\claude.exe", CommandLine: "claude --input-format stream-json --permission-prompt-tool stdio" },
    { Name: "conhost.exe", ProcessId: 11, ParentProcessId: 10, CommandLine: "conhost.exe" },
    { Name: "cmd.exe", ProcessId: 12, ParentProcessId: 10, CommandLine: "cmd /c npx @playwright/mcp@latest" },
    { Name: "claude.exe", ProcessId: 20, ParentProcessId: 1, ExecutablePath: "C:\\Claude\\claude-code\\claude.exe", CommandLine: "claude --input-format stream-json --permission-prompt-tool stdio" },
    { Name: "powershell.exe", ProcessId: 21, ParentProcessId: 20, CommandLine: "powershell -File heartbeat.ps1" },
  ]);
  assert.equal(result.claudeAgents, 2);
  assert.equal(result.claudeDesktopBackgroundAgents, 1);
});

test("detects the Codex desktop app separately from Codex CLI agents", () => {
  const result = summarizeProcesses([
    {
      Name: "ChatGPT.exe",
      ProcessId: 10,
      ParentProcessId: 1,
      ExecutablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0_x64__test\\app\\ChatGPT.exe",
      CommandLine: "ChatGPT.exe",
    },
  ]);
  assert.equal(result.codexDesktopOpen, true);
  assert.deepEqual(result.codexDesktopPids, [10]);
  assert.equal(result.codexCliAgents, 0);
});
