import fs from "node:fs/promises";

export const MAX_LOG_BYTES = 256 * 1024;

async function preserveTail(filePath, backupPath, maxBytes) {
  const handle = await fs.open(filePath, "r");
  try {
    const { size } = await handle.stat();
    const tailBytes = Math.min(size, Math.floor(maxBytes / 2));
    const tail = Buffer.alloc(tailBytes);
    if (tailBytes > 0) await handle.read(tail, 0, tailBytes, size - tailBytes);
    await fs.writeFile(backupPath, tail);
  } finally {
    await handle.close();
  }
  await fs.truncate(filePath, 0);
}

export async function appendBoundedLog(filePath, message, options = {}) {
  const maxBytes = options.maxBytes || MAX_LOG_BYTES;
  const line = `[${new Date().toISOString()}] ${String(message)}\n`;
  try {
    const size = await fs.stat(filePath).then((stat) => stat.size).catch(() => 0);
    if (size + Buffer.byteLength(line, "utf8") > maxBytes) {
      await preserveTail(filePath, `${filePath}.1`, maxBytes);
    }
    await fs.appendFile(filePath, line, "utf8");
  } catch {
    // Logging must never stop the presence daemon.
  }
}
