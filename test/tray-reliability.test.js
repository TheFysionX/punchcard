import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requestTrayExit } from "../lib/tray.js";

test("tray exit requests are durable so the supervisor does not undo Quit", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-tray-exit-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const paths = { home, trayExit: path.join(home, "tray-exit") };

  await requestTrayExit(paths);

  assert.match(await fs.readFile(paths.trayExit, "utf8"), /^\d+\n$/u);
});

test("Windows tray host supervises both the tray UI and presence daemon", async () => {
  const source = await fs.readFile(new URL("../lib/tray.js", import.meta.url), "utf8");
  assert.match(source, /while \(!stopping && !\(await trayExitRequested\(paths\)\)\)/u);
  assert.match(source, /Tray UI stopped unexpectedly/u);
  assert.match(source, /setInterval\(\(\) => \{\s*ensureDaemonRunning\(paths\)/u);
  assert.match(source, /Presence daemon was not running; restarted it as pid/u);
});
