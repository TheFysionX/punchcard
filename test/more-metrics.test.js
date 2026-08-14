import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appPaths } from "../lib/paths.js";
import { readSettings } from "../lib/state.js";
import {
  fetchPrivateProfileStats,
  installMoreMetrics,
  readMoreMetricsStatus,
  refreshMoreMetrics,
  removeMoreMetrics,
  setProfileVisibility,
} from "../lib/more-metrics.js";

async function fixture(context) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-more-metrics-"));
  context.after(() => fs.rm(home, { recursive: true, force: true }));
  return appPaths({ CLAUDE_CODEX_PRESENCE_HOME: home });
}

test("More Metrics is disabled by default", async (context) => {
  const paths = await fixture(context);
  const settings = await readSettings(paths);
  assert.equal(settings.moreMetrics, false);
  assert.equal(settings.moreMetricsPending, false);
  assert.equal(settings.showProfileInStatus, false);
  assert.deepEqual(await readMoreMetricsStatus(paths), { state: "not-installed" });
});

test("More Metrics installs only the pinned optional package inside managed state", async (context) => {
  const paths = await fixture(context);
  let npmArguments;
  const result = await installMoreMetrics(paths, {
    runNpm: async (arguments_) => {
      npmArguments = arguments_;
      const packageRoot = path.join(paths.moreMetricsRoot, "node_modules", "punchcard-advanced-metrics");
      await fs.mkdir(packageRoot, { recursive: true });
      await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
        name: "punchcard-advanced-metrics",
        version: "1.0.0",
        exports: { "./punchcard": "./src/lifecycle.mjs" },
      }), "utf8");
      return 0;
    },
    lifecycle: {
      activateMetrics: async ({ home }) => {
        await fs.mkdir(home, { recursive: true });
        await fs.writeFile(path.join(home, "snapshot.json"), "{}", "utf8");
      },
    },
  });

  assert.equal(result.installed, true);
  assert.equal(result.version, "1.0.0");
  assert.deepEqual(npmArguments.slice(0, 4), [
    "install",
    "--prefix",
    paths.moreMetricsRoot,
    "punchcard-advanced-metrics@1.0.1",
  ]);
  for (const required of ["--no-save", "--package-lock=false", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]) {
    assert.ok(npmArguments.includes(required), `missing ${required}`);
  }
  assert.equal((await readMoreMetricsStatus(paths)).state, "installed");

  let deactivated = false;
  await removeMoreMetrics(paths, {
    lifecycle: {
      deactivateMetrics: async () => { deactivated = true; },
    },
  });
  assert.equal(deactivated, true);
  assert.equal(await fs.access(paths.moreMetricsRoot).then(() => true).catch(() => false), false);
  assert.equal((await readMoreMetricsStatus(paths)).state, "not-installed");
});

test("a failed optional install is cleaned up instead of bloating Punchcard", async (context) => {
  const paths = await fixture(context);
  await assert.rejects(
    () => installMoreMetrics(paths, { runNpm: async () => 2 }),
    /npm install exited with code 2/u,
  );
  assert.equal(await fs.access(paths.moreMetricsRoot).then(() => true).catch(() => false), false);
  const status = await readMoreMetricsStatus(paths);
  assert.equal(status.state, "failed");
  assert.match(status.error, /code 2/u);
});

test("More Metrics uploads one signed batch and commits cursors only after Cloudflare acknowledges it", async (context) => {
  const paths = await fixture(context);
  let completedBatch = null;
  let request = null;
  let preparedOptions = null;
  const codexAccountUsageOptions = { nodeExecutable: "/opt/homebrew/bin/node" };
  const result = await refreshMoreMetrics(paths, {
    identity: { discordUserId: "123456789012345678", username: "theo", displayName: "Theo" },
    baseUrl: "https://app.punchcardai.workers.dev",
    lifecycle: {
      prepareMetricsSync: async (options) => {
        preparedOptions = options;
        return {
          active: true,
          payload: { batchId: "batch-one", profile: options.identity, buckets: [] },
          signature: "signed",
        };
      },
      completeMetricsSync: async ({ batchId }) => {
        completedBatch = batchId;
        return { acknowledged: true };
      },
    },
    codexAccountUsageOptions,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ acknowledged: true, batchId: "batch-one" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(result, { acknowledged: true });
  assert.equal(request.url, "https://app.punchcardai.workers.dev/api/v1/metrics/ingest");
  assert.equal(JSON.parse(request.options.body).signature, "signed");
  assert.equal(preparedOptions.codexAccountUsageOptions, codexAccountUsageOptions);
  assert.equal(completedBatch, "batch-one");
});

test("private profile operations are signed by More Metrics and sent only to Punchcard", async (context) => {
  const paths = await fixture(context);
  const requests = [];
  const lifecycle = {
    preparePrivateStatsRequest: async ({ range }) => ({ payload: { action: "read-private-stats", range }, signature: "read-signature" }),
    prepareProfileVisibilityRequest: async ({ isPublic }) => ({ payload: { action: "set-profile-visibility", isPublic }, signature: "write-signature" }),
  };
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    const body = url.endsWith("/private-stats")
      ? { kpis: ["1K"] }
      : { updated: true, isPublic: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };

  assert.deepEqual(await fetchPrivateProfileStats(paths, "30d", { lifecycle, fetchImpl }), { kpis: ["1K"] });
  assert.deepEqual(await setProfileVisibility(paths, true, { lifecycle, fetchImpl }), { updated: true, isPublic: true });
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://app.punchcardai.workers.dev/api/v1/profile/private-stats",
    "https://app.punchcardai.workers.dev/api/v1/profile/visibility",
  ]);
  assert.equal(requests[0].body.signature, "read-signature");
  assert.equal(requests[1].body.payload.isPublic, true);
});

test("the Windows settings panel exposes the optional More Metrics toggle", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tray = await fs.readFile(path.join(root, "scripts", "tray.ps1"), "utf8");
  assert.match(tray, /New-Toggle "More Metrics"/u);
  assert.match(tray, /New-Toggle "Show my profile in my status"/u);
  assert.match(tray, /\$showProfileInStatusToggle\.Visible = \$moreMetricsExpanded/u);
  assert.match(tray, /"profile-link"/u);
  assert.match(tray, /MoreMetricsStatusPath/u);
  assert.match(tray, /"more-metrics", \$action, "--json"/u);
});
