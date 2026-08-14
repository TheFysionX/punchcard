import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readSettings } from "../lib/state.js";
import { normalizeProfileBaseUrl, profileSnapshot } from "../lib/profile.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    baseUrl: null,
    url: null,
  });
});

test("Discord READY identity resolves only with a configured profile host", () => {
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

test("tray exposes the public profile only after its optional integration is configured", async () => {
  const [tray, cli] = await Promise.all([
    fs.readFile(path.join(root, "scripts", "tray.ps1"), "utf8"),
    fs.readFile(path.join(root, "bin", "cli.js"), "utf8"),
  ]);

  assert.match(tray, /New-Button "View profile"/);
  assert.match(tray, /\$status\.profile\.url/u);
  assert.match(tray, /\$viewProfileButton\.Visible = \$profileReady/);
  assert.match(cli, /case "profile":/u);
  assert.match(cli, /normalizeProfileBaseUrl\(requestedBaseUrl\)/u);
});
