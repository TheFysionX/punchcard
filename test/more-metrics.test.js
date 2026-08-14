import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appPaths } from "../lib/paths.js";
import { readSettings } from "../lib/state.js";
import {
  installMoreMetrics,
  readMoreMetricsStatus,
  removeMoreMetrics,
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
        version: "0.1.28",
      }), "utf8");
      return 0;
    },
  });

  assert.equal(result.installed, true);
  assert.equal(result.version, "0.1.28");
  assert.deepEqual(npmArguments.slice(0, 4), [
    "install",
    "--prefix",
    paths.moreMetricsRoot,
    "punchcard-advanced-metrics@0.1.28",
  ]);
  for (const required of ["--no-save", "--package-lock=false", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]) {
    assert.ok(npmArguments.includes(required), `missing ${required}`);
  }
  assert.equal((await readMoreMetricsStatus(paths)).state, "installed");

  await removeMoreMetrics(paths);
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

test("the Windows settings panel exposes the optional More Metrics toggle", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tray = await fs.readFile(path.join(root, "scripts", "tray.ps1"), "utf8");
  assert.match(tray, /New-Toggle "More Metrics"/u);
  assert.match(tray, /MoreMetricsStatusPath/u);
  assert.match(tray, /"more-metrics", \$action, "--json"/u);
});
