import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { findNpmCli } from "./npm-cli.js";

export const MORE_METRICS_PACKAGE = "punchcard-advanced-metrics";
export const MORE_METRICS_VERSION = "1.0.1";
export const MORE_METRICS_API_BASE_URL = "https://app.punchcardai.workers.dev";

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

function metricsDataDirectory(root) {
  return path.join(root, "data");
}

function apiBaseUrl(options = {}) {
  return String(options.baseUrl || (options.env || process.env).PUNCHCARD_PROFILE_BASE_URL || MORE_METRICS_API_BASE_URL).replace(/\/+$/u, "");
}

async function loadLifecycle(packageRoot) {
  const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  const target = metadata?.exports?.["./punchcard"];
  if (metadata?.name !== MORE_METRICS_PACKAGE || typeof target !== "string" || !target.startsWith("./")) {
    throw new Error("The installed More Metrics lifecycle contract is invalid");
  }
  const modulePath = path.resolve(packageRoot, target);
  const relative = path.relative(packageRoot, modulePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The installed More Metrics lifecycle contract is invalid");
  }
  return import(pathToFileURL(modulePath).href);
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
      state: "activating",
      packageName: metadata.name,
      version: metadata.version,
    });
    const lifecycle = options.lifecycle || await loadLifecycle(packageDirectory(root, config.packageName));
    if (typeof lifecycle.activateMetrics !== "function") {
      throw new Error("The installed More Metrics lifecycle contract is invalid");
    }
    await lifecycle.activateMetrics({ home: metricsDataDirectory(root) });
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

export async function refreshMoreMetrics(paths, options = {}) {
  const root = assertManagedRoot(paths);
  const config = packageConfig(options.env);
  const packageRoot = packageDirectory(root, config.packageName);
  const lifecycle = options.lifecycle || await loadLifecycle(packageRoot);
  if (typeof lifecycle.prepareMetricsSync !== "function" || typeof lifecycle.completeMetricsSync !== "function") {
    throw new Error("The installed More Metrics lifecycle contract is invalid");
  }
  const prepared = await lifecycle.prepareMetricsSync({
    home: metricsDataDirectory(root),
    identity: options.identity,
    codexAccountUsageOptions: options.codexAccountUsageOptions,
  });
  if (prepared?.active !== true || prepared.busy) return prepared;
  if (!prepared.payload || typeof prepared.signature !== "string") {
    throw new Error("More Metrics did not produce a valid sync batch");
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("This Node.js version cannot upload More Metrics");
  const baseUrl = apiBaseUrl(options);
  const response = await fetchImpl(`${baseUrl}/api/v1/metrics/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload: prepared.payload, signature: prepared.signature }),
    signal: AbortSignal.timeout(30_000),
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok || body?.acknowledged !== true || body?.batchId !== prepared.payload.batchId) {
    throw new Error(body?.error || `Cloudflare metrics upload failed with status ${response.status}`);
  }
  const completed = await lifecycle.completeMetricsSync({
    home: metricsDataDirectory(root),
    batchId: prepared.payload.batchId,
  });
  if (typeof options.isPublic === "boolean") {
    await setProfileVisibility(paths, options.isPublic, { ...options, lifecycle, baseUrl });
  }
  return completed;
}

async function signedProfileRequest(paths, endpoint, prepareMethod, prepareOptions, options = {}) {
  const root = assertManagedRoot(paths);
  const config = packageConfig(options.env);
  const lifecycle = options.lifecycle || await loadLifecycle(packageDirectory(root, config.packageName));
  if (typeof lifecycle[prepareMethod] !== "function") {
    throw new Error("The installed More Metrics package does not support private profiles yet");
  }
  const envelope = await lifecycle[prepareMethod]({
    home: metricsDataDirectory(root),
    ...prepareOptions,
  });
  if (!envelope?.payload || typeof envelope.signature !== "string") {
    throw new Error("More Metrics did not produce a valid device request");
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("This Node.js version cannot access Punchcard profiles");
  const response = await fetchImpl(`${apiBaseUrl(options)}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(30_000),
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.error || `Punchcard profile request failed with status ${response.status}`);
  return body;
}

export async function fetchPrivateProfileStats(paths, range = "all", options = {}) {
  return signedProfileRequest(
    paths,
    "/api/v1/profile/private-stats",
    "preparePrivateStatsRequest",
    { range },
    options,
  );
}

export async function setProfileVisibility(paths, isPublic, options = {}) {
  const body = await signedProfileRequest(
    paths,
    "/api/v1/profile/visibility",
    "prepareProfileVisibilityRequest",
    { isPublic: Boolean(isPublic) },
    options,
  );
  if (body?.updated !== true || body?.isPublic !== Boolean(isPublic)) {
    throw new Error("Punchcard did not confirm the profile visibility change");
  }
  return body;
}

export async function removeMoreMetrics(paths, options = {}) {
  const root = assertManagedRoot(paths);
  await writeMoreMetricsStatus(paths, { state: "removing" });
  try {
    const config = packageConfig(options.env);
    const lifecycle = options.lifecycle || await loadLifecycle(packageDirectory(root, config.packageName));
    if (typeof lifecycle.deactivateMetrics === "function") {
      await lifecycle.deactivateMetrics({ home: metricsDataDirectory(root) });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      // Removing the managed root is the authoritative deactivation boundary.
    }
  }
  await fs.rm(root, { recursive: true, force: true });
  await writeMoreMetricsStatus(paths, { state: "not-installed" });
  return { installed: false, root };
}
