import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;

function publicDiscordText(value, maximum = 80) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/u.test(cleaned)) return null;
  return cleaned;
}

export function publicDiscordUser(payload) {
  if (payload?.cmd !== "DISPATCH" || payload?.evt !== "READY") return null;
  const username = publicDiscordText(payload.data?.user?.username);
  const id = publicDiscordText(payload.data?.user?.id, 32);
  if (!username || !id || !/^\d{5,32}$/u.test(id)) return null;
  return {
    id,
    username,
    displayName: publicDiscordText(payload.data?.user?.global_name)
      || publicDiscordText(payload.data?.user?.display_name)
      || username,
  };
}

export function encodeFrame(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const frame = Buffer.allocUnsafe(8 + body.length);
  frame.writeInt32LE(opcode, 0);
  frame.writeInt32LE(body.length, 4);
  body.copy(frame, 8);
  return frame;
}

export function ipcCandidates(env = process.env) {
  if (process.platform === "win32") {
    return Array.from({ length: 10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  }
  const roots = [...new Set([
    env.XDG_RUNTIME_DIR,
    env.TMPDIR,
    env.TMP,
    env.TEMP,
    `/run/user/${typeof process.getuid === "function" ? process.getuid() : ""}`,
    os.tmpdir(),
    "/tmp",
  ].filter(Boolean))];
  return roots.flatMap((root) => [
    ...Array.from({ length: 10 }, (_, index) => path.join(root, `discord-ipc-${index}`)),
    ...Array.from({ length: 10 }, (_, index) => path.join(root, "app", "com.discordapp.Discord", `discord-ipc-${index}`)),
    ...Array.from({ length: 10 }, (_, index) => path.join(root, "snap.discord", `discord-ipc-${index}`)),
  ]);
}

function connectSocket(candidate, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(candidate);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${candidate}`));
    }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

export class DiscordIPC {
  constructor(clientId) {
    this.clientId = String(clientId);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connecting = null;
    this.ready = false;
    this.user = null;
    this.readyWaiter = null;
    this.pending = new Map();
  }

  async connect() {
    if (this.socket && this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try { await this.connecting; } finally { this.connecting = null; }
  }

  async open() {
    let lastError = new Error("Discord desktop IPC was not found");
    for (const candidate of ipcCandidates()) {
      try {
        const socket = await connectSocket(candidate);
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        this.ready = false;
        socket.on("data", (chunk) => this.onData(chunk));
        socket.on("close", () => {
          this.socket = null;
          this.ready = false;
          this.user = null;
          for (const { reject, timer } of this.pending.values()) {
            clearTimeout(timer);
            reject(new Error("Discord IPC connection closed"));
          }
          this.pending.clear();
        });
        socket.on("error", () => {});
        const readyPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Discord handshake timed out")), 5_000);
          this.readyWaiter = { resolve: () => { clearTimeout(timer); resolve(); }, reject };
        });
        socket.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
        await readyPromise;
        return;
      } catch (error) {
        lastError = error;
        this.socket?.destroy();
        this.socket = null;
      }
    }
    throw lastError;
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > 4 * 1024 * 1024) {
        this.socket?.destroy(new Error("Invalid Discord frame length"));
        return;
      }
      if (this.buffer.length < 8 + length) return;
      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      let payload;
      try { payload = JSON.parse(body.toString("utf8")); } catch { continue; }
      if (payload.cmd === "DISPATCH" && payload.evt === "READY") {
        this.ready = true;
        this.user = publicDiscordUser(payload);
        this.readyWaiter?.resolve();
        this.readyWaiter = null;
      }
      if (payload.nonce && this.pending.has(payload.nonce)) {
        const pending = this.pending.get(payload.nonce);
        this.pending.delete(payload.nonce);
        clearTimeout(pending.timer);
        if (payload.evt === "ERROR") {
          pending.reject(new Error(payload.data?.message || "Discord rejected the activity"));
        } else {
          pending.resolve(payload);
        }
      }
    }
  }

  async setActivity(activity) {
    await this.connect();
    const nonce = randomUUID();
    const payload = {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity },
      nonce,
    };
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error("Discord did not acknowledge the activity"));
      }, 5_000);
      this.pending.set(nonce, { resolve, reject, timer });
    });
    this.socket.write(encodeFrame(OP_FRAME, payload));
    await response;
  }

  async close(clear = false) {
    if (clear && this.socket && this.ready) {
      try { await this.setActivity(null); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.socket?.end();
    this.socket?.destroy();
    this.socket = null;
    this.ready = false;
    this.user = null;
  }
}
