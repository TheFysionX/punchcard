import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { findNpmCli } from "./npm-cli.js";

export const MORE_METRICS_PACKAGE = "punchcard-advanced-metrics";
export const MORE_METRICS_VERSION = "0.1.28";

function packageConfig(env = process.env) {
  const packageName = String(
    env.PUNCHCARD_MORE_METRICS_PACKAGE_NAME
      || env.CODESENSE_MORE_METRICS_PACKAGE_NAME
      || MORE_METRICS_PACKAGE,
  ).trim();
  const packageSpec = String(
    env.PUNCHCARD_MORE_METRICS_PACKAGE_SPEC
      || env.CODESENSE_MORE_METRICS_PACKAGE_SPEC
      || `${packageName}@${MORE_METRICS_VERSION}`,
  ).trim();
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName)
    || !packageSpec
    || packageSpec.length > 512
    || /[\u0000-\u001f\u007f]/u.test(packageSpec)) {
    throw new Error("The More Metrics package configuration is invalid");
  }
  return { packageName, packageSpec };
}

function packageDirectory(root, packageName) {
  return path.join(root, "node_modules", ...packageName.split("/"));
}

function assertManagedRoot(paths) {
  const appHome = path.resolve(paths.home);
  const root = path.resolve(paths.moreMetricsRoot);
  const relative = path.relative(appHome, root);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The More Metrics install directory is outside Punchcard state");
  }
  return root;
}

async function atomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, filePath);
}

export async function readMoreMetricsStatus(paths) {
  try {
    const parsed = JSON.parse(await fs.readFile(paths.moreMetricsStatus, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : { state: "not-installed" };
  } catch {
    return { state: "not-installed" };
  }
}

export async function writeMoreMetricsStatus(paths, value) {
  const safe = {
    state: String(value.state || "unknown").slice(0, 40),
    packageName: value.packageName ? String(value.packageName).slice(0, 120) : null,
    version: value.version ? String(value.version).slice(0, 40) : null,
    error: value.error ? String(value.error).slice(0, 240) : null,
    updatedAt: new Date().toISOString(),
  };
  await atomicJson(paths.moreMetricsStatus, safe);
  return safe;
}

async function defaultRunNpm(arguments_, options = {}) {
  const npmCli = await findNpmCli(options);
  const child = spawn(options.nodeExecutable || process.execPath, [npmCli, ...arguments_], {
    windowsHide: true,
    stdio: "ignore",
    env: options.env || process.env,
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

export async function installMoreMetrics(paths, options = {}) {
  const root = assertManagedRoot(paths);
  const config = packageConfig(options.env);
  const runNpm = options.runNpm || defaultRunNpm;
  await fs.mkdir(root, { recursive: true });
  await writeMoreMetricsStatus(paths, { state: "installing", packageName: config.packageName });
  try {
    const exitCode = await runNpm([
      "install",
      "--prefix", root,
      config.packageSpec,
      "--no-save",
      "--package-lock=false",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ], options);
    if (exitCode !== 0) throw new Error(`npm install exited with code ${exitCode}`);
    const metadata = JSON.parse(await fs.readFile(
      path.join(packageDirectory(root, config.packageName), "package.json"),
      "utf8",
    ));
    if (metadata.name !== config.packageName || typeof metadata.version !== "string") {
      throw new Error("The installed More Metrics package did not match its requested identity");
    }
    await writeMoreMetricsStatus(paths, {
      state: "installed",
      packageName: metadata.name,
      version: metadata.version,
    });
    return { installed: true, packageName: metadata.name, version: metadata.version, root };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    await writeMoreMetricsStatus(paths, {
      state: "failed",
      packageName: config.packageName,
      error: error instanceof Error ? error.message : "Installation failed",
    });
    throw error;
  }
}

export async function removeMoreMetrics(paths) {
  const root = assertManagedRoot(paths);
  await writeMoreMetricsStatus(paths, { state: "removing" });
  await fs.rm(root, { recursive: true, force: true });
  await writeMoreMetricsStatus(paths, { state: "not-installed" });
  return { installed: false, root };
}
