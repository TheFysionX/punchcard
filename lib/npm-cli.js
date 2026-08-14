import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function findNpmCli(options = {}) {
  const env = options.env || process.env;
  const executable = options.nodeExecutable || process.execPath;
  const candidates = [
    env.npm_execpath,
    path.join(path.dirname(executable), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "npm", "bin", "npm-cli.js"),
    "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    "/usr/lib/node_modules/npm/bin/npm-cli.js",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("npm-cli.js could not be located");
}
