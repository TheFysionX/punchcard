import test from "node:test";
import assert from "node:assert/strict";
import { DiscordIPC, encodeFrame, publicDiscordUser } from "../lib/discord-ipc.js";

test("encodes Discord IPC frames", () => {
  const payload = { v: 1, client_id: "123" };
  const frame = encodeFrame(0, payload);
  assert.equal(frame.readInt32LE(0), 0);
  assert.equal(frame.readInt32LE(4), Buffer.byteLength(JSON.stringify(payload)));
  assert.deepEqual(JSON.parse(frame.subarray(8).toString("utf8")), payload);
});

test("captures only the public Discord identity from READY", async () => {
  const payload = {
    cmd: "DISPATCH",
    evt: "READY",
    data: {
      user: {
        id: "private-id-not-needed",
        username: "theo.codes",
        global_name: "Theo",
        email: "must-not-escape@example.com",
      },
    },
  };
  assert.deepEqual(publicDiscordUser(payload), { username: "theo.codes", displayName: "Theo" });

  const ipc = new DiscordIPC("123");
  ipc.readyWaiter = { resolve() {}, reject() {} };
  ipc.onData(encodeFrame(1, payload));
  assert.deepEqual(ipc.user, { username: "theo.codes", displayName: "Theo" });
  assert.doesNotMatch(JSON.stringify(ipc.user), /private-id|must-not-escape/u);
  await ipc.close();
  assert.equal(ipc.user, null);
});
