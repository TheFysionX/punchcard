import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findNpmCli } from "../lib/npm-cli.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-release-"));
const npmCli = await findNpmCli();

function fail(message, result) {
  const detail = result ? `\n${result.stderr || result.stdout || ""}` : "";
  throw new Error(`${message}${detail}`);
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  if (result.error || result.status !== 0) fail(`${command} ${arguments_.join(" ")} failed`, result);
  return result.stdout;
}

try {
  const packedOutput = run(process.execPath, [npmCli,
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    temporary,
  ]);
  const packed = JSON.parse(packedOutput)[0];
  if (!packed?.filename) fail("npm pack did not return a tarball filename");

  const allowedFiles = new Set([
    "package.json",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "docs/MACOS.md",
    "docs/PRIVACY.md",
    "scripts/postinstall.cjs",
    "scripts/tray.ps1",
    "scripts/tray-macos.js",
  ]);
  const allowedDirectories = ["bin/", "lib/"];
  for (const entry of packed.files || []) {
    const normalized = entry.path.replaceAll("\\", "/");
    if (!allowedFiles.has(normalized) && !allowedDirectories.some((prefix) => normalized.startsWith(prefix))) {
      fail(`Unexpected file in npm tarball: ${normalized}`);
    }
    if (/^(?:test|tools|\.github|node_modules)\//u.test(normalized)) {
      fail(`Development-only file leaked into npm tarball: ${normalized}`);
    }
  }

  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "bin/cli.js",
    "lib/daemon.js",
    "lib/platform.js",
    "scripts/postinstall.cjs",
    "scripts/tray.ps1",
    "scripts/tray-macos.js",
    "docs/MACOS.md",
    "docs/PRIVACY.md",
  ]) {
    if (!(packed.files || []).some((entry) => entry.path.replaceAll("\\", "/") === required)) {
      fail(`Required npm file is missing: ${required}`);
    }
  }

  if (packed.unpackedSize > 300_000) {
    fail(`npm tarball is unexpectedly large (${packed.unpackedSize} bytes); review the package allowlist`);
  }

  const tarball = path.join(temporary, packed.filename);
  const installRoot = path.join(temporary, "install");
  run(process.execPath, [npmCli,
    "install",
    "--prefix",
    installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ]);

  const installedRoot = path.join(installRoot, "node_modules", metadata.name);
  const installedMetadata = JSON.parse(await fs.readFile(path.join(installedRoot, "package.json"), "utf8"));
  if (installedMetadata.version !== metadata.version) fail("Installed tarball version does not match package.json");

  const isolatedHome = path.join(temporary, "state");
  const help = run(process.execPath, [path.join(installedRoot, "bin", "cli.js"), "help"], {
    env: {
      ...process.env,
      CLAUDE_CODEX_PRESENCE_HOME: isolatedHome,
      CODEX_HOME: path.join(temporary, "codex"),
      CLAUDE_CONFIG_DIR: path.join(temporary, "claude"),
      CLAUDE_CODEX_PRESENCE_NO_AUTOSTART: "1",
    },
  });
  if (!help.includes("Usage: punchcard")) fail("The installed Punchcard CLI did not start correctly");

  const version = run(process.execPath, [path.join(installedRoot, "bin", "cli.js"), "--version"], {
    env: {
      ...process.env,
      CLAUDE_CODEX_PRESENCE_HOME: isolatedHome,
      CODEX_HOME: path.join(temporary, "codex"),
      CLAUDE_CONFIG_DIR: path.join(temporary, "claude"),
      CLAUDE_CODEX_PRESENCE_NO_AUTOSTART: "1",
    },
  }).trim();
  if (version !== metadata.version) fail(`Installed CLI reported version ${version || "<empty>"}`);

  console.log(`Smoke-tested ${metadata.name}@${metadata.version}: ${packed.entryCount} files, ${packed.unpackedSize} unpacked bytes.`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
