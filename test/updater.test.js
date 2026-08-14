import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkForUpdate, compareVersions, isValidVersion } from "../lib/updater.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("compares release versions and validates registry versions", () => {
  assert.equal(compareVersions("0.4.2", "0.4.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(isValidVersion("2.3.4"), true);
  assert.equal(isValidVersion("latest & remove-everything"), false);
});

test("checks the npm latest version without estimating or mutating", async () => {
  const update = await checkForUpdate({
    packageName: "example-package",
    currentVersion: "0.4.2",
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: "0.5.0" }) }),
  });
  assert.deepEqual(update, {
    currentVersion: "0.4.2",
    latestVersion: "0.5.0",
    updateAvailable: true,
    error: null,
  });
});

test("rejects an invalid version returned by the registry", async () => {
  const update = await checkForUpdate({
    packageName: "example-package",
    currentVersion: "0.4.2",
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: "0.5.0 && bad" }) }),
  });
  assert.equal(update.updateAvailable, false);
  assert.match(update.error, /invalid version/);
});

test("the tray checks frequently using its actual running version", async () => {
  const tray = await fs.readFile(path.join(root, "scripts", "tray.ps1"), "utf8");
  assert.match(tray, /update-check", "--current-version", \$CurrentVersion, "--json"/u);
  assert.match(tray, /"update", "--current-version", \$CurrentVersion, "--json"/u);
  assert.match(tray, /autoUpdateIntervalMinutes = 15/u);
  assert.match(tray, /TotalMinutes -ge \$script:autoUpdateIntervalMinutes/u);
  assert.doesNotMatch(tray, /TotalHours -ge 24/u);
});
