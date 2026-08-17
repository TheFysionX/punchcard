import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { ACTIVE_SUBAGENT_STALE_MS, ACTIVE_TURN_STALE_MS } from "./constants.js";
import { appPaths } from "./paths.js";
import { readOpenCodexSidechatIds } from "./codex-sidechats.js";
import { CodexDesktopActivity } from "./codex-desktop-activity.js";

export const ROLLING_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isTimestampToday(timestamp, now = new Date()) {
  const parsed = new Date(timestamp);
  return !Number.isNaN(parsed.valueOf()) && localDayKey(parsed) === localDayKey(now);
}

function startOfLocalDay(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).valueOf();
}

function walkJsonl(root) {
  if (!fs.existsSync(root)) return [];
  const pending = [root];
  const files = [];
  while (pending.length) {
    const dir = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
    }
  }
  return files;
}

function sumClaudeUsage(usage = {}) {
  return [
    usage.input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
    usage.output_tokens,
  ].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

async function readNewText(file, offset) {
  const stat = await fsPromises.stat(file);
  if (stat.size <= offset) return { text: "", size: stat.size };
  const length = stat.size - offset;
  const handle = await fsPromises.open(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    await handle.read(buffer, 0, length, offset);
    return { text: buffer.toString("utf8"), size: stat.size };
  } finally {
    await handle.close();
  }
}

export class LocalTelemetry {
  constructor(paths = appPaths(), options = {}) {
    this.paths = paths;
    this.readCodexSidechats = options.readCodexSidechats || readOpenCodexSidechatIds;
    this.codexDesktopActivity = options.codexDesktopActivity
      || new CodexDesktopActivity(paths.codexDesktopLogs || []);
    this.reset(new Date());
  }

  reset(now) {
    this.day = localDayKey(now);
    this.codexTokenEvents = [];
    this.fileStates = new Map();
    this.claudeMessages = new Map();
    this.codexTurns = new Map();
    this.codexSessionKinds = new Map();
    this.codexSessionIds = new Map();
    this.codexParentIds = new Map();
    this.codexUsageReady = new Set();
    this.codexUsageTotals = new Map();
  }

  processCodexLine(file, line, now) {
    let item;
    try { item = JSON.parse(line); } catch { return; }
    const currentTurn = this.codexTurns.get(file);
    if (currentTurn?.active && item.timestamp) currentTurn.lastSeen = item.timestamp;
    if (item.type === "session_meta" && item.payload && !this.codexSessionKinds.has(file)) {
      const meta = item.payload;
      const isSubagent = meta.thread_source === "subagent"
        || Boolean(meta.source?.subagent)
        || Boolean(meta.agent_path);
      this.codexSessionKinds.set(file, isSubagent ? "subagent" : "main");
      if (meta.id) this.codexSessionIds.set(file, meta.id);
      const parentId = meta.source?.subagent?.thread_spawn?.parent_thread_id;
      if (parentId) this.codexParentIds.set(file, parentId);
      return;
    }
    if (item.type === "turn_context") {
      this.codexUsageReady.add(file);
      return;
    }
    if (item.type !== "event_msg" || !item.payload) return;
    const eventType = item.payload.type;
    if (eventType === "token_count") {
      const cumulative = item.payload.info?.total_token_usage?.total_tokens;
      const previous = this.codexUsageTotals.get(file);
      if (Number.isFinite(cumulative)) this.codexUsageTotals.set(file, cumulative);
      if (!this.codexUsageReady.has(file) || (Number.isFinite(cumulative) && cumulative === previous)) return;
      const timestampMs = new Date(item.timestamp).valueOf();
      const total = item.payload.info?.last_token_usage?.total_tokens;
      if (Number.isFinite(timestampMs) && timestampMs >= now.valueOf() - ROLLING_WEEK_MS && Number.isFinite(total)) {
        this.codexTokenEvents.push({ timestampMs, tokens: total });
      }
    }
    if (eventType === "task_started") {
      this.codexTurns.set(file, { active: true, status: eventType, timestamp: item.timestamp, lastSeen: item.timestamp });
    } else if (eventType === "task_complete" || eventType === "turn_aborted") {
      this.codexTurns.set(file, { active: false, status: eventType, timestamp: item.timestamp });
    }
  }

  processClaudeLine(line, now) {
    let item;
    try { item = JSON.parse(line); } catch { return; }
    if (item.type !== "assistant" || !item.message?.usage) return;
    const timestampMs = new Date(item.timestamp).valueOf();
    if (!Number.isFinite(timestampMs) || timestampMs < now.valueOf() - ROLLING_WEEK_MS) return;
    const messageId = item.message.id || item.uuid;
    if (!messageId) return;
    const key = item.message.id || `${item.sessionId || "unknown"}:${messageId}`;
    const next = sumClaudeUsage(item.message.usage);
    this.claudeMessages.set(key, { timestampMs, tokens: next });
  }

  async scanFile(file, vendor, now) {
    let state = this.fileStates.get(file) || { offset: 0, remainder: "" };
    let stat;
    try { stat = await fsPromises.stat(file); } catch { return false; }
    if (stat.size < state.offset) return true;
    const { text, size } = await readNewText(file, state.offset);
    if (!text) return false;
    const chunks = `${state.remainder}${text}`.split(/\r?\n/);
    state = { offset: size, remainder: chunks.pop() || "" };
    for (const line of chunks) {
      if (!line) continue;
      if (vendor === "codex") this.processCodexLine(file, line, now);
      else this.processClaudeLine(line, now);
    }
    this.fileStates.set(file, state);
    return false;
  }

  async refresh(now = new Date(), options = {}) {
    if (this.day !== localDayKey(now)) this.reset(now);
    const dayStart = startOfLocalDay(now);
    const rollingWeekStart = now.valueOf() - ROLLING_WEEK_MS;
    const sources = [
      ["codex", this.paths.codexSessions],
      ["claude", this.paths.claudeProjects],
    ];
    for (const [vendor, root] of sources) {
      for (const file of walkJsonl(root)) {
        let stat;
        try { stat = await fsPromises.stat(file); } catch { continue; }
        if (!this.fileStates.has(file) && stat.mtimeMs < rollingWeekStart) continue;
        const truncated = await this.scanFile(file, vendor, now);
        if (truncated) {
          this.reset(now);
          return this.refresh(now, options);
        }
      }
    }
    const activeCodexTurns = [...this.codexTurns.entries()].filter(([file, turn]) => {
      if (!turn.active) return false;
      const time = new Date(turn.lastSeen || turn.timestamp).valueOf();
      const staleMs = this.codexSessionKinds.get(file) === "subagent"
        ? ACTIVE_SUBAGENT_STALE_MS
        : ACTIVE_TURN_STALE_MS;
      return Number.isFinite(time) && time >= now.valueOf() - staleMs;
    });
    const activeMainTurns = activeCodexTurns.filter(([file]) => this.codexSessionKinds.get(file) !== "subagent");
    const activeMainIds = new Set(activeMainTurns.map(([file]) => this.codexSessionIds.get(file)).filter(Boolean));
    const knownMainIds = new Set([...this.codexSessionIds.entries()]
      .filter(([file]) => this.codexSessionKinds.get(file) !== "subagent")
      .map(([, id]) => id));
    const activeSubagentTurns = activeCodexTurns.filter(([file]) => {
      if (this.codexSessionKinds.get(file) !== "subagent") return false;
      const parentId = this.codexParentIds.get(file);
      return parentId ? knownMainIds.has(parentId) : activeMainTurns.length > 0;
    });
    const openSidechats = await this.readCodexSidechats(
      this.paths.codexStateCandidates || this.paths.codexState,
      activeMainIds,
      now.valueOf(),
      ACTIVE_SUBAGENT_STALE_MS,
    );
    const desktopTurns = await this.codexDesktopActivity.refresh(now, {
      codexDesktopOpen: options.codexDesktopOpen === true,
      codexDesktopPids: options.codexDesktopPids || [],
    });
    const activeSubagentIds = new Set(activeSubagentTurns.map(([file]) => this.codexSessionIds.get(file) || file));
    if (openSidechats.available) {
      const turnById = new Map([...this.codexSessionIds.entries()]
        .map(([file, id]) => [id, this.codexTurns.get(file)]));
      for (const id of openSidechats.ids) {
        if (turnById.get(id)?.status !== "turn_aborted") activeSubagentIds.add(id);
      }
    }
    if (desktopTurns.available) {
      for (const id of desktopTurns.ids) {
        if (!activeMainIds.has(id)) activeSubagentIds.add(id);
      }
    }
    const codexMainAgents = activeMainTurns.length;
    const codexSubagents = activeSubagentIds.size;
    const codexActiveAgents = codexMainAgents + codexSubagents;
    this.codexTokenEvents = this.codexTokenEvents.filter((event) => event.timestampMs >= rollingWeekStart);
    for (const [key, message] of this.claudeMessages) {
      if (message.timestampMs < rollingWeekStart) this.claudeMessages.delete(key);
    }
    const codexTokens = this.codexTokenEvents
      .filter((event) => event.timestampMs >= dayStart)
      .reduce((sum, event) => sum + event.tokens, 0);
    const codexTokensWeek = this.codexTokenEvents.reduce((sum, event) => sum + event.tokens, 0);
    const claudeUsage = [...this.claudeMessages.values()];
    const claudeTokens = claudeUsage
      .filter((message) => message.timestampMs >= dayStart)
      .reduce((sum, message) => sum + message.tokens, 0);
    const claudeTokensWeek = claudeUsage.reduce((sum, message) => sum + message.tokens, 0);
    return {
      codexTokens,
      claudeTokens,
      totalTokens: codexTokens + claudeTokens,
      codexTokensWeek,
      claudeTokensWeek,
      totalTokensWeek: codexTokensWeek + claudeTokensWeek,
      codexActiveAgents,
      codexMainAgents,
      codexSubagents,
    };
  }
}
