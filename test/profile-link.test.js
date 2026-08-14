import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readSettings } from "../lib/state.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("public profile is unconfigured by default", async () => {
  const settings = await readSettings({
    home: path.join(root, ".missing-profile-settings"),
    settings: path.join(root, ".missing-profile-settings", "settings.json"),
  });

  assert.equal(settings.profileBaseUrl, null);
  assert.equal(settings.profileUsername, null);
});

test("tray exposes the public profile only after its optional integration is configured", async () => {
  const tray = await fs.readFile(path.join(root, "scripts", "tray.ps1"), "utf8");

  assert.match(tray, /New-Button "View profile"/);
  assert.match(tray, /\$username\/stats/);
  assert.match(tray, /PUNCHCARD_PROFILE_BASE_URL/);
  assert.match(tray, /\$viewProfileButton\.Visible = \$profileReady/);
});
