import test from "node:test";
import assert from "node:assert/strict";
import { encodeFrame } from "../lib/discord-ipc.js";

test("encodes Discord IPC frames", () => {
  const payload = { v: 1, client_id: "123" };
  const frame = encodeFrame(0, payload);
  assert.equal(frame.readInt32LE(0), 0);
  assert.equal(frame.readInt32LE(4), Buffer.byteLength(JSON.stringify(payload)));
  assert.deepEqual(JSON.parse(frame.subarray(8).toString("utf8")), payload);
});
