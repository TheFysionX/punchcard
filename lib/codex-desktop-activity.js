import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

const START_MARKER = "method=turn/start";
const COMPLETE_MARKER = "[desktop-notifications] show turn-complete";
const CONVERSATION_ID = /\bconversationId=([0-9a-f-]{20,})\b/iu;

function walkLogs(root) {
  if (!root || !fs.existsSync(root)) return [];
  const pending = [root];
  const files = [];
  while (pending.length) {
    const directory = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.endsWith(".log")) files.push(full);
    }
  }
  return files;
}

function sessionIdentity(file, desktopPids) {
  const name = path.basename(file);
  for (const pid of desktopPids) {
    const marker = `-${pid}-`;
    const index = name.indexOf(marker);
    if (index >= 0) return { key: name.slice(0, index + marker.length - 1), pid };
  }
  const match = name.match(/^(.*-(\d+))-t\d+-/u);
  return match ? { key: match[1], pid: Number(match[2]) } : null;
}

export function applyCodexDesktopLifecycleLine(active, line) {
  const match = line.match(CONVERSATION_ID);
  if (!match) return;
  const id = match[1];
  if (line.includes(START_MARKER) && line.includes("errorCode=null")) {
    active.add(id);
  } else if (line.includes(COMPLETE_MARKER)) {
    active.delete(id);
  }
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

export class CodexDesktopActivity {
  constructor(logRoots = []) {
    this.logRoots = Array.isArray(logRoots) ? logRoots : [logRoots];
    this.active = new Set();
    this.fileStates = new Map();
    this.currentSessionKeys = "";
  }

  reset() {
    this.active.clear();
    this.fileStates.clear();
    this.currentSessionKeys = "";
  }

  async scan(file) {
    let state = this.fileStates.get(file) || { offset: 0, remainder: "" };
    let stat;
    try { stat = await fsPromises.stat(file); } catch { return; }
    if (stat.size < state.offset) state = { offset: 0, remainder: "" };
    const { text, size } = await readNewText(file, state.offset);
    if (!text) return;
    const lines = `${state.remainder}${text}`.split(/\r?\n/u);
    state = { offset: size, remainder: lines.pop() || "" };
    for (const line of lines) applyCodexDesktopLifecycleLine(this.active, line);
    this.fileStates.set(file, state);
  }

  async refresh(_now = new Date(), options = {}) {
    if (options.codexDesktopOpen !== true) {
      this.reset();
      return { available: false, ids: new Set() };
    }

    const desktopPids = new Set((options.codexDesktopPids || []).map(Number).filter(Number.isFinite));
    const candidates = [];
    for (const root of this.logRoots) {
      for (const file of walkLogs(root)) {
        let stat;
        try { stat = await fsPromises.stat(file); } catch { continue; }
        const identity = sessionIdentity(file, desktopPids);
        if (!identity) continue;
        if (desktopPids.size > 0 && !desktopPids.has(identity.pid)) continue;
        candidates.push({ file, key: identity.key, pid: identity.pid, mtimeMs: stat.mtimeMs });
      }
    }
    if (candidates.length === 0) return { available: false, ids: new Set() };

    const newestByKey = new Map();
    for (const candidate of candidates) {
      newestByKey.set(candidate.key, Math.max(newestByKey.get(candidate.key) || 0, candidate.mtimeMs));
    }
    const selectedKeys = desktopPids.size > 0
      ? [...desktopPids].flatMap((pid) => {
          const newest = [...newestByKey.entries()]
            .filter(([key]) => key.endsWith(`-${pid}`))
            .sort((a, b) => b[1] - a[1])[0];
          return newest ? [newest[0]] : [];
        })
      : [[...newestByKey.entries()].sort((a, b) => b[1] - a[1])[0][0]];
    const serializedKeys = [...selectedKeys].sort().join("\n");
    if (this.currentSessionKeys && this.currentSessionKeys !== serializedKeys) this.reset();
    this.currentSessionKeys = serializedKeys;

    const selected = candidates
      .filter((candidate) => selectedKeys.includes(candidate.key))
      .sort((a, b) => a.file.localeCompare(b.file));
    for (const { file } of selected) await this.scan(file);
    return { available: true, ids: new Set(this.active) };
  }
}
