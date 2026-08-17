import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appPaths } from "../lib/paths.js";
import { createPrivateDashboard } from "../lib/private-dashboard.js";

test("private dashboard requires its one-time ticket and serves signed stats only through loopback", async () => {
  const upstream = [];
  const dashboard = await createPrivateDashboard(appPaths({ CLAUDE_CODEX_PRESENCE_HOME: "C:/punchcard-test" }), {
    username: "demo",
    baseUrl: "https://app.punchcardai.workers.dev",
    idleMs: 30_000,
    fetchImpl: async (url) => {
      upstream.push(url);
      return new Response("<!doctype html><title>Punchcard</title>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
    fetchPrivateStats: async (_paths, range) => ({ range, kpis: ["42"] }),
  });
  try {
    const denied = await fetch(`${dashboard.origin}/demo/stats`);
    assert.equal(denied.status, 404);

    const admitted = await fetch(dashboard.url, { redirect: "manual" });
    assert.equal(admitted.status, 302);
    assert.equal(admitted.headers.get("location"), "/demo/stats");
    const cookie = admitted.headers.get("set-cookie").split(";", 1)[0];

    const page = await fetch(`${dashboard.origin}/demo/stats`, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Punchcard/u);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("x-frame-options"), "DENY");

    const stats = await fetch(`${dashboard.origin}/api/profiles/demo/stats?range=90d`, { headers: { cookie } });
    assert.equal(stats.status, 200);
    assert.deepEqual(await stats.json(), { range: "90d", kpis: ["42"] });
    assert.deepEqual(upstream, ["https://app.punchcardai.workers.dev/index.html"]);
  } finally {
    await dashboard.close();
  }
});

test("private dashboard reports a fresh collector sync as setup pending", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-private-dashboard-"));
  const paths = appPaths({ PUNCHCARD_HOME: home });
  await fs.mkdir(path.join(paths.moreMetricsRoot, "data"), { recursive: true });
  await fs.writeFile(path.join(paths.moreMetricsRoot, "data", "status.json"), JSON.stringify({
    active: true,
    state: "refreshing",
    lastSyncedAt: null,
  }));
  const dashboard = await createPrivateDashboard(paths, {
    username: "demo",
    idleMs: 30_000,
    fetchPrivateStats: async () => {
      throw new Error("This device is not paired with a Punchcard profile.");
    },
  });
  try {
    const admitted = await fetch(dashboard.url, { redirect: "manual" });
    const cookie = admitted.headers.get("set-cookie").split(";", 1)[0];
    const stats = await fetch(`${dashboard.origin}/api/profiles/demo/stats?range=all`, { headers: { cookie } });
    assert.equal(stats.status, 425);
    assert.deepEqual(await stats.json(), {
      code: "INSIGHTS_SETUP_PENDING",
      error: "Punchcard is still setting up your private insights.",
    });

    await fs.writeFile(path.join(paths.moreMetricsRoot, "data", "status.json"), JSON.stringify({
      active: true,
      state: "synced",
      lastSyncedAt: "2026-08-15T01:37:15.259Z",
    }));
    const failed = await fetch(`${dashboard.origin}/api/profiles/demo/stats?range=all`, { headers: { cookie } });
    assert.equal(failed.status, 502);
    assert.equal(await failed.text(), "This device is not paired with a Punchcard profile.");
  } finally {
    await dashboard.close();
    await fs.rm(home, { recursive: true, force: true });
  }
});
