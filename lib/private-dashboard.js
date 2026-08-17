import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPrivateProfileStats } from "./more-metrics.js";
import { normalizeProfileBaseUrl } from "./profile.js";

const DEFAULT_IDLE_MS = 30 * 60 * 1_000;
const VALID_RANGES = new Set(["30d", "90d", "ytd", "all"]);
const COOKIE_NAME = "punchcard_private_session";
const SETUP_PENDING_CODE = "INSIGHTS_SETUP_PENDING";

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([key, value]) => key && value)
    .map(([key, value]) => [key, decodeURIComponent(value)]));
}

function secureHeaders(contentType) {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function send(response, status, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  response.writeHead(status, { ...secureHeaders(contentType), ...extraHeaders });
  response.end(body);
}

async function isInitialInsightsSetup(paths, error) {
  if (!String(error?.message || error).includes("not paired with a Punchcard profile")) return false;
  try {
    const status = JSON.parse(await fs.readFile(path.join(paths.moreMetricsRoot, "data", "status.json"), "utf8"));
    return status?.active === true
      && status.lastSyncedAt == null
      && ["ready", "refreshing", "pending-upload"].includes(status.state);
  } catch {
    return false;
  }
}

export function openExternal(url, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const commands = process.platform === "win32"
    ? [{ executable: "rundll32.exe", arguments: ["url.dll,FileProtocolHandler", url] }]
    : process.platform === "darwin"
      ? [{ executable: "/usr/bin/open", arguments: [url] }]
      : [{ executable: "xdg-open", arguments: [url] }];
  for (const command of commands) {
    try {
      const child = spawnImpl(command.executable, command.arguments, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once?.("error", () => {});
      child.unref?.();
      return true;
    } catch {}
  }
  return false;
}

export async function createPrivateDashboard(paths, options = {}) {
  const username = String(options.username || "").trim();
  if (!username || username.length > 80) throw new Error("A connected Punchcard profile is required");
  const baseUrl = normalizeProfileBaseUrl(options.baseUrl) || "https://app.punchcardai.workers.dev";
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const privateStats = options.fetchPrivateStats || fetchPrivateProfileStats;
  const ticket = randomBytes(32).toString("base64url");
  const session = randomBytes(32).toString("base64url");
  const encodedUsername = encodeURIComponent(username);
  let expectedHost = null;
  let idleTimer = null;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;

  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== expectedHost) {
        send(response, 400, "Invalid local host.");
        return;
      }
      const localOrigin = `http://${expectedHost}`;
      if (request.headers.origin && request.headers.origin !== localOrigin) {
        send(response, 403, "Cross-origin requests are not allowed.");
        return;
      }
      const url = new URL(request.url || "/", localOrigin);
      const profilePath = `/${encodedUsername}/stats`;
      if (url.pathname === profilePath && sameSecret(url.searchParams.get("ticket"), ticket)) {
        response.writeHead(302, {
          ...secureHeaders("text/plain; charset=utf-8"),
          location: profilePath,
          "set-cookie": `${COOKIE_NAME}=${encodeURIComponent(session)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(1, Math.ceil(idleMs / 1_000))}`,
        });
        response.end();
        return;
      }
      if (!sameSecret(cookies(request)[COOKIE_NAME], session)) {
        send(response, 404, "Not found.");
        return;
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => server.close(), idleMs);

      const apiMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/stats$/u);
      if (apiMatch) {
        let handle;
        try { handle = decodeURIComponent(apiMatch[1]); } catch { handle = ""; }
        const range = url.searchParams.get("range") || "all";
        if (request.method !== "GET" || handle !== username || !VALID_RANGES.has(range)) {
          send(response, 404, JSON.stringify({ error: "Not found." }), "application/json; charset=utf-8");
          return;
        }
        try {
          const stats = await privateStats(paths, range, { baseUrl, fetchImpl });
          send(response, 200, JSON.stringify(stats), "application/json; charset=utf-8");
        } catch (error) {
          if (await isInitialInsightsSetup(paths, error)) {
            send(response, 425, JSON.stringify({
              code: SETUP_PENDING_CODE,
              error: "Punchcard is still setting up your private insights.",
            }), "application/json; charset=utf-8");
            return;
          }
          throw error;
        }
        return;
      }

      const isAsset = url.pathname.startsWith("/assets/");
      const isAppRoute = url.pathname === "/" || url.pathname === profilePath;
      if (request.method !== "GET" || (!isAsset && !isAppRoute)) {
        send(response, 404, "Not found.");
        return;
      }
      const remotePath = isAppRoute ? "/index.html" : url.pathname;
      const upstream = await fetchImpl(`${baseUrl}${remotePath}`, {
        headers: { accept: request.headers.accept || "*/*" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!upstream.ok) {
        send(response, 502, "Punchcard dashboard assets are unavailable.");
        return;
      }
      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      send(response, 200, Buffer.from(await upstream.arrayBuffer()), contentType);
    } catch (error) {
      send(response, 502, error instanceof Error ? error.message : "Private dashboard failed.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  expectedHost = `127.0.0.1:${address.port}`;
  idleTimer = setTimeout(() => server.close(), idleMs);
  server.once("close", () => clearTimeout(idleTimer));
  const url = `http://${expectedHost}/${encodedUsername}/stats?ticket=${encodeURIComponent(ticket)}`;
  return {
    url,
    origin: `http://${expectedHost}`,
    closed: new Promise((resolve) => server.once("close", resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function runPrivateDashboard(paths, options = {}) {
  const dashboard = await createPrivateDashboard(paths, options);
  if (options.open !== false) openExternal(dashboard.url, options);
  await dashboard.closed;
}

export function startPrivateDashboardDetached(options = {}) {
  const cliPath = options.cliPath || fileURLToPath(new URL("../bin/cli.js", import.meta.url));
  const child = spawn(options.nodeExecutable || process.execPath, [cliPath, "private-dashboard"], {
    cwd: options.cwd || path.dirname(cliPath),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: options.env || process.env,
  });
  child.unref();
  return child.pid;
}

export async function appendPrivateDashboardError(paths, error) {
  await fs.mkdir(paths.home, { recursive: true });
  await fs.appendFile(
    paths.privateDashboardLog,
    `[${new Date().toISOString()}] ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    "utf8",
  );
}
