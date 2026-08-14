import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchAgentPlist } from "../lib/autostart.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "package.json");
const metadata = JSON.parse(await fs.readFile(packagePath, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

assert(metadata.name === "punchcard-presence", "Unexpected npm package name");
assert(/^\d+\.\d+\.\d+$/u.test(metadata.version), "Release version must be stable semantic versioning");
assert(metadata.bin?.punchcard === "bin/cli.js", "The punchcard CLI mapping is missing");
assert(metadata.license === "MIT", "The package license must remain explicit");
assert(metadata.engines?.node === ">=18", "The supported Node.js range changed without updating release checks");
assert(metadata.repository?.url === "git+https://github.com/TheFysionX/punchcard.git", "Repository metadata is not canonical");
assert(metadata.publishConfig?.registry === "https://registry.npmjs.org/", "Publishing must target the public npm registry");
assert(metadata.publishConfig?.access === "public", "The package must publish publicly");
assert(!metadata.dependencies || Object.keys(metadata.dependencies).length === 0, "Runtime dependencies require an explicit release review");
assert(!metadata.optionalDependencies || Object.keys(metadata.optionalDependencies).length === 0, "Optional npm dependencies require an explicit release review");

for (const required of ["README.md", "LICENSE", "CHANGELOG.md", "PRIVACY.md", "SECURITY.md"]) {
  assert(metadata.files.includes(required), `${required} is missing from the npm allowlist`);
  await fs.access(path.join(root, required));
}

const sourceRoots = ["bin", "lib", "scripts", "test", "tools"];
const sourceFiles = (await Promise.all(sourceRoots.map((name) => walk(path.join(root, name))))).flat();
for (const file of sourceFiles.filter((file) => /\.(?:c?js|mjs)$/u.test(file))) {
  const checked = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" });
  assert(checked.status === 0, `${path.relative(root, file)} failed syntax validation:\n${checked.stderr || checked.stdout}`);
}

if (process.platform === "win32") {
  const trayPath = path.join(root, "scripts", "tray.ps1");
  const escapedPath = trayPath.replaceAll("'", "''");
  const command = `$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${escapedPath}', [ref]$tokens, [ref]$errors); if ($errors.Count) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }`;
  const checked = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert(checked.status === 0, `scripts/tray.ps1 failed syntax validation:\n${checked.stderr || checked.stdout}`);
}

if (process.platform === "darwin") {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "punchcard-macos-check-"));
  try {
    const plistPath = path.join(temporary, "com.punchcard.presence.plist");
    const compiledScript = path.join(temporary, "Punchcard.scpt");
    await fs.writeFile(plistPath, launchAgentPlist(), "utf8");
    const plistCheck = spawnSync("/usr/bin/plutil", ["-lint", plistPath], { cwd: root, encoding: "utf8" });
    assert(plistCheck.status === 0, `Generated LaunchAgent failed plutil validation:\n${plistCheck.stderr || plistCheck.stdout}`);
    const scriptCheck = spawnSync("/usr/bin/osacompile", [
      "-l", "JavaScript",
      "-o", compiledScript,
      path.join(root, "scripts", "tray-macos.js"),
    ], { cwd: root, encoding: "utf8" });
    assert(scriptCheck.status === 0, `scripts/tray-macos.js failed JXA compilation:\n${scriptCheck.stderr || scriptCheck.stdout}`);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

for (const relativePath of ["bin", "lib", "scripts", "README.md", "PRIVACY.md"]) {
  const target = path.join(root, relativePath);
  const files = (await fs.stat(target)).isDirectory() ? await walk(target) : [target];
  for (const file of files.filter((file) => !file.endsWith(".png"))) {
    const contents = await fs.readFile(file, "utf8");
    assert(!/C:\\Users\\/iu.test(contents), `${path.relative(root, file)} contains a machine-specific user path`);
  }
}

const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
assert(readme.includes("npm install -g punchcard-presence"), "README install instructions are missing");
assert(!readme.includes("The only network-adjacent action"), "README contains the obsolete network claim");
assert(!readme.includes("http://localhost:4173"), "README contains a development profile destination");

console.log(`Package checks passed for ${metadata.name}@${metadata.version} (${sourceFiles.length} source files).`);
