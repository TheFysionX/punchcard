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

export async function readOpenCodexSidechatIds(databasePath, activeMainIds, nowMs, staleMs) {
  if (!databasePath || activeMainIds.size === 0) return { available: false, ids: new Set() };
  let database;
  try {
    const { DatabaseSync } = await import("node:sqlite");
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
    return { available: false, ids: new Set() };
  } finally {
    try { database?.close(); } catch {}
  }
}
