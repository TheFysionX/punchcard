import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appPaths } from "./paths.js";

const hookTag = "CLAUDE_CODEX_PRESENCE_HOOK";
const cliPath = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const hookEvents = ["UserPromptSubmit", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "SessionEnd"];

function quote(value) {
  if (process.platform !== "win32") return `'${String(value).replaceAll("'", `'\\''`)}'`;
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function hookCommand() {
  return `${quote(process.execPath)} ${quote(cliPath)} hook ${hookTag}`;
}

function withoutPresenceHooks(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => {
    if (!group || !Array.isArray(group.hooks)) return [group];
    const hooks = group.hooks.filter((hook) => !String(hook?.command || "").includes(hookTag));
    return hooks.length ? [{ ...group, hooks }] : [];
  });
}

async function readClaudeSettings(settingsPath) {
  try { return JSON.parse(await fs.readFile(settingsPath, "utf8")); } catch { return {}; }
}

export async function installClaudeHooks(paths = appPaths()) {
  const settings = await readClaudeSettings(paths.claudeSettings);
  const hooks = { ...(settings.hooks || {}) };
  for (const event of hookEvents) {
    hooks[event] = [
      ...withoutPresenceHooks(hooks[event]),
      {
        hooks: [{
          type: "command",
          command: hookCommand(),
          timeout: 5,
        }],
      },
    ];
  }
  await fs.mkdir(path.dirname(paths.claudeSettings), { recursive: true });
  await fs.writeFile(paths.claudeSettings, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`, "utf8");
  return { settings: paths.claudeSettings, events: hookEvents };
}

export async function removeClaudeHooks(paths = appPaths()) {
  const settings = await readClaudeSettings(paths.claudeSettings);
  if (!settings.hooks) return;
  const hooks = { ...settings.hooks };
  for (const event of hookEvents) {
    const remaining = withoutPresenceHooks(hooks[event]);
    if (remaining.length) hooks[event] = remaining;
    else delete hooks[event];
  }
  const next = { ...settings };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  await fs.writeFile(paths.claudeSettings, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export { hookEvents };
