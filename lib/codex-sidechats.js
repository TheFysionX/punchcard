import fs from "node:fs/promises";

const SIDECHAT_PREFIX = "sidechat:";

export function selectOpenCodexUiSidechatIds(globalState) {
  const atoms = globalState?.["electron-persisted-atom-state"];
  if (!atoms || typeof atoms !== "object") return new Set();

  const ids = new Set();
  for (const [key, route] of Object.entries(atoms)) {
    if (!key.startsWith("thread-tab-routes-v1:")) continue;
    const topology = route?.topology;
    if (!topology || typeof topology !== "object") continue;
    for (const area of Object.values(topology)) {
      if (!area || typeof area !== "object" || area.open !== true) continue;
      const tabId = area.activeTabId;
      if (typeof tabId !== "string" || !tabId.startsWith(SIDECHAT_PREFIX)) continue;
      const id = tabId.slice(SIDECHAT_PREFIX.length);
      if (id) ids.add(id);
    }
  }
  return ids;
}

export async function readOpenCodexUiSidechatIds(globalStatePath, codexDesktopOpen) {
  if (!globalStatePath || codexDesktopOpen !== true) return { available: false, ids: new Set() };
  try {
    const globalState = JSON.parse(await fs.readFile(globalStatePath, "utf8"));
    return {
      available: true,
      ids: selectOpenCodexUiSidechatIds(globalState),
    };
  } catch {
    return { available: false, ids: new Set() };
  }
}

export function selectRecentOpenSidechatIds(edges, activeMainIds, nowMs, staleMs) {
  const childrenByParent = new Map();
  const edgeByChild = new Map();
  for (const edge of edges) {
    if (edge.status !== "open" || edge.archived) continue;
    const children = childrenByParent.get(edge.parentId) || [];
    children.push(edge.childId);
    childrenByParent.set(edge.parentId, children);
    edgeByChild.set(edge.childId, edge);
  }

  const reachable = new Set();
  const pending = [...activeMainIds];
  while (pending.length) {
    const parentId = pending.pop();
    for (const childId of childrenByParent.get(parentId) || []) {
      if (reachable.has(childId)) continue;
      reachable.add(childId);
      pending.push(childId);
    }
  }

  const cutoff = nowMs - staleMs;
  return new Set([...reachable].filter((childId) => {
    const updatedAtMs = edgeByChild.get(childId)?.updatedAtMs;
    return Number.isFinite(updatedAtMs) && updatedAtMs >= cutoff;
  }));
}

export async function readOpenCodexSidechatIds(databasePaths, activeMainIds, nowMs, staleMs) {
  const candidates = (Array.isArray(databasePaths) ? databasePaths : [databasePaths]).filter(Boolean);
  if (candidates.length === 0 || activeMainIds.size === 0) return { available: false, ids: new Set() };
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return { available: false, ids: new Set() };
  }
  for (const databasePath of candidates) {
    let database;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      const rows = database.prepare(`
      SELECT
        edge.parent_thread_id AS parentId,
        edge.child_thread_id AS childId,
        edge.status AS status,
        COALESCE(thread.archived, 0) AS archived,
        COALESCE(thread.updated_at_ms, thread.updated_at * 1000) AS updatedAtMs
      FROM thread_spawn_edges AS edge
      LEFT JOIN threads AS thread ON thread.id = edge.child_thread_id
      `).all().map((row) => ({
        parentId: String(row.parentId),
        childId: String(row.childId),
        status: String(row.status),
        archived: Boolean(row.archived),
        updatedAtMs: Number(row.updatedAtMs),
      }));
      return {
        available: true,
        ids: selectRecentOpenSidechatIds(rows, activeMainIds, nowMs, staleMs),
      };
    } catch {
      // Codex has used more than one state location. Try the next known candidate.
    } finally {
      try { database?.close(); } catch {}
    }
  }
  return { available: false, ids: new Set() };
}
