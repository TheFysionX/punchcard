import test from "node:test";
import assert from "node:assert/strict";
import {
  selectOpenCodexUiSidechatIds,
  selectRecentOpenSidechatIds,
} from "../lib/codex-sidechats.js";

test("selects only the active sidechat tab from each open desktop area", () => {
  const ids = selectOpenCodexUiSidechatIds({
    "electron-persisted-atom-state": {
      "thread-tab-routes-v1:main": {
        topology: {
          right: {
            activeTabId: "sidechat:active",
            open: true,
            tabIds: ["sidechat:idle", "sidechat:active", "browser:preview"],
          },
          bottom: {
            activeTabId: null,
            open: false,
            tabIds: ["sidechat:bottom"],
          },
        },
      },
      "thread-tab-routes-v1:unrelated": {
        topology: {
          right: { activeTabId: "sidechat:other", open: true, tabIds: ["sidechat:other"] },
        },
      },
    },
  });

  assert.deepEqual([...ids].sort(), ["active", "other"]);
});

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
