import assert from "node:assert/strict";
import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { appPaths } from "../lib/paths.js";
import { readSettings, writeSettings } from "../lib/state.js";
import { normalizeProfileBaseUrl, profileSnapshot, profileStateUrl } from "../lib/profile.js";

const execFile = promisify(nodeExecFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "cli.js");

test("public profile is unconfigured by default", async () => {
  const settings = await readSettings({
    home: path.join(root, ".missing-profile-settings"),
    settings: path.join(root, ".missing-profile-settings", "settings.json"),
  });

  assert.equal(settings.profileBaseUrl, null);
  assert.equal(Object.hasOwn(settings, "profileUsername"), false);
  assert.deepEqual(profileSnapshot(settings), {
    username: null,
    displayName: null,
    baseUrl: "https://app.punchcardai.workers.dev",
    url: null,
  });
});

test("Discord READY identity resolves on the default Cloudflare profile host", () => {
  const discordUser = { username: "theo.codes", displayName: "Theo" };
  assert.equal(profileSnapshot({}, { discordUser }).url, null);
  assert.equal(profileSnapshot({ profileBaseUrl: "https://app.punchcard.example" }, { discordUser }).url, null);
  assert.deepEqual(profileSnapshot({
    moreMetrics: true,
    profileBaseUrl: "https://app.punchcard.example",
  }, { discordUser }), {
    username: "theo.codes",
    displayName: "Theo",
    baseUrl: "https://app.punchcard.example",
    url: "https://app.punchcard.example/theo.codes/stats",
  });
});

test("Discord token text links to the profile only after the user opts in", () => {
  const discordUser = { username: "demo", displayName: "Demo" };
  assert.equal(profileStateUrl({ moreMetrics: true }, { discordUser }), null);
  assert.equal(profileStateUrl({ showProfileInStatus: true }, { discordUser }), null);
  assert.equal(profileStateUrl({ moreMetrics: true, showProfileInStatus: true }, { discordUser }),
    "https://app.punchcardai.workers.dev/demo/stats");
});

test("profile-link command persists the opt-in independently", async (context) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-profile-link-"));
  context.after(() => fs.rm(home, { recursive: true, force: true }));
  const paths = appPaths({ CLAUDE_CODEX_PRESENCE_HOME: home });
  await writeSettings({ moreMetrics: true }, paths);
  const packageRoot = path.join(paths.moreMetricsRoot, "node_modules", "punchcard-advanced-metrics");
  await fs.mkdir(path.join(packageRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "punchcard-advanced-metrics",
    version: "1.0.0",
    type: "module",
    exports: { "./punchcard": "./src/lifecycle.mjs" },
  }), "utf8");
  await fs.writeFile(path.join(packageRoot, "src", "lifecycle.mjs"), `
    export async function prepareProfileVisibilityRequest({ isPublic }) {
      return { payload: { isPublic }, signature: "signed" };
    }
  `, "utf8");
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ updated: true, isPublic: envelope.payload.isPublic }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const run = async (value) => {
    const result = await execFile(process.execPath, [cli, "profile-link", value, "--json"], {
      cwd: root,
      env: { ...process.env, CLAUDE_CODEX_PRESENCE_HOME: home, PUNCHCARD_PROFILE_BASE_URL: baseUrl },
    });
    return JSON.parse(result.stdout);
  };

  assert.deepEqual(await run("on"), { available: true, enabled: true });
  assert.equal((await readSettings(paths)).showProfileInStatus, true);
  assert.deepEqual(await run("off"), { available: true, enabled: false });
  assert.equal((await readSettings(paths)).showProfileInStatus, false);
});

test("profile hosts reject executable URLs, credentials, queries, and fragments", () => {
  for (const value of [
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "https://example.com?redirect=elsewhere",
    "https://example.com/#fragment",
  ]) {
    assert.equal(normalizeProfileBaseUrl(value), null);
  }
  assert.equal(normalizeProfileBaseUrl("https://example.com/base/"), "https://example.com/base");
});

test("tray opens public profiles or private local insights from the same control", async () => {
  const [tray, cli] = await Promise.all([
    fs.readFile(path.join(root, "scripts", "tray.ps1"), "utf8"),
    fs.readFile(path.join(root, "bin", "cli.js"), "utf8"),
  ]);

  assert.match(tray, /New-Button "View profile"/);
  assert.match(tray, /"profile-open", "--json"/u);
  assert.match(tray, /\$viewProfileButton\.Visible = \$profileReady/);
  assert.match(tray, /\$connectItem = \$quickMenu\.Items\.Add\("Connect Discord"\)\s+\$profileItem = \$quickMenu\.Items\.Add\("View profile"\)\s+\[void\]\$quickMenu\.Items\.Add\(\[System\.Windows\.Forms\.ToolStripSeparator\]::new\(\)\)/u);
  assert.match(tray, /\$profileItem\.Enabled = \$profileReady/u);
  assert.match(tray, /View private insights/u);
  assert.match(tray, /\$profileItem\.add_Click\(\{ Open-Profile \}\)/u);
  assert.match(cli, /case "profile":/u);
  assert.match(cli, /case "profile-open":/u);
  assert.match(cli, /case "private-dashboard":/u);
  assert.match(cli, /case "profile-link":/u);
  assert.match(cli, /normalizeProfileBaseUrl\(requestedBaseUrl\)/u);
});
