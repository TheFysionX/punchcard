import test from "node:test";
import assert from "node:assert/strict";
import { selectRecentOpenSidechatIds } from "../lib/codex-sidechats.js";

test("selects recent open sidechats reachable from active main tasks", () => {
  const hour = 60 * 60 * 1000;
  const now = 20 * hour;
  const ids = selectRecentOpenSidechatIds([
    { parentId: "main", childId: "idle", status: "open", archived: false, updatedAtMs: now - hour },
    { parentId: "idle", childId: "nested", status: "open", archived: false, updatedAtMs: now - (2 * hour) },
    { parentId: "main", childId: "closed", status: "closed", archived: false, updatedAtMs: now },
    { parentId: "main", childId: "archived", status: "open", archived: true, updatedAtMs: now },
    { parentId: "main", childId: "stale", status: "open", archived: false, updatedAtMs: now - (13 * hour) },
    { parentId: "other", childId: "unrelated", status: "open", archived: false, updatedAtMs: now },
  ], new Set(["main"]), now, 12 * hour);

  assert.deepEqual([...ids].sort(), ["idle", "nested"]);
});
