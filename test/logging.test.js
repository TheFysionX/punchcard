import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { appendBoundedLog } from "../lib/logging.js";

test("runtime logs rotate into one bounded backup", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-log-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const log = path.join(root, "daemon.log");

  for (let index = 0; index < 30; index += 1) {
    await appendBoundedLog(log, `${index}:${"x".repeat(40)}`, { maxBytes: 256 });
  }

  const current = await fs.stat(log);
  const backup = await fs.stat(`${log}.1`);
  assert.ok(current.size <= 256);
  assert.ok(backup.size <= 128);
});
