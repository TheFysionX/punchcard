import fs from "node:fs/promises";
import { MORE_METRICS_REFRESH_MS, UPDATE_INTERVAL_MS } from "./constants.js";
import { appPaths } from "./paths.js";
import { readSettings, ensureHome, writeStatus } from "./state.js";
import { LocalTelemetry } from "./usage.js";
import { detectProcesses } from "./processes.js";
import { buildPresence, nextPresenceStartedAt } from "./activity.js";
import { DiscordIPC } from "./discord-ipc.js";
import { addClaudeDesktopBackground, readClaudeActivity } from "./claude-activity.js";
import { appendBoundedLog } from "./logging.js";
import { profileSnapshot, profileStateUrl } from "./profile.js";
import { refreshMoreMetrics } from "./more-metrics.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDaemon() {
  const paths = appPaths();
  await ensureHome(paths);
  await fs.writeFile(paths.pid, `${process.pid}\n`, "utf8");
  let settings = await readSettings(paths);
  if (!settings.enabled) {
    await fs.rm(paths.pid, { force: true });
    return;
  }
  const telemetry = new LocalTelemetry(paths);
  let discord = null;
  let discordClientId = null;
  let stopping = false;
  let lastActivity = "";
  const carriedPresenceStartedAt = Number(process.env.PUNCHCARD_PRESENCE_STARTED_AT);
  let presenceStartedAt = Number.isFinite(carriedPresenceStartedAt) && carriedPresenceStartedAt > 0
    ? carriedPresenceStartedAt
    : null;
  let moreMetricsEnabled = false;
  let moreMetricsRefresh = null;
  let nextMoreMetricsRefreshAt = 0;

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await discord?.close(true);
    await fs.rm(paths.pid, { force: true });
  };
  const stopAndExit = () => { void stop().then(() => process.exit(0)); };
  process.once("SIGINT", stopAndExit);
  process.once("SIGTERM", stopAndExit);
  process.once("exit", () => { void fs.rm(paths.pid, { force: true }); });

  await appendBoundedLog(paths.log, `daemon started (pid ${process.pid})`);
  while (!stopping) {
    const checkedAt = new Date();
    let usage = { codexTokens: 0, claudeTokens: 0, totalTokens: 0, codexTokensWeek: 0, claudeTokensWeek: 0, totalTokensWeek: 0, codexActiveAgents: 0 };
    let processes = { claudeOpen: false, claudeAgents: 0, codexOpen: false, codexDesktopOpen: false, codexCliAgents: 0 };
    let claude = { activeAgents: 0, mainAgents: 0, subagents: 0 };
    let discordConnected = false;
    let error = null;
    let activity = null;
    try {
      settings = await readSettings(paths);
      if (settings.moreMetrics === true && !settings.moreMetricsPending) {
        if (!moreMetricsEnabled) {
          moreMetricsEnabled = true;
          nextMoreMetricsRefreshAt = 0;
        }
        if (!moreMetricsRefresh && checkedAt.valueOf() >= nextMoreMetricsRefreshAt && discord?.user?.id) {
          nextMoreMetricsRefreshAt = checkedAt.valueOf() + MORE_METRICS_REFRESH_MS;
          moreMetricsRefresh = refreshMoreMetrics(paths, {
            identity: {
              discordUserId: discord.user.id,
              username: discord.user.username,
              displayName: discord.user.displayName,
            },
            baseUrl: settings.profileBaseUrl,
            isPublic: settings.showProfileInStatus === true,
            codexAccountUsageOptions: { nodeExecutable: process.execPath },
          })
            .catch((refreshError) => {
              nextMoreMetricsRefreshAt = Date.now() + 60_000;
              return appendBoundedLog(
                paths.log,
                `More Metrics sync failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
              );
            })
            .finally(() => { moreMetricsRefresh = null; });
        }
      } else {
        moreMetricsEnabled = false;
        nextMoreMetricsRefreshAt = 0;
      }
      const processesPromise = detectProcesses();
      const claudePromise = readClaudeActivity(paths, checkedAt);
      processes = await processesPromise;
      [usage, claude] = await Promise.all([
        telemetry.refresh(checkedAt, { codexDesktopOpen: processes.codexDesktopOpen }),
        claudePromise,
      ]);
      claude = addClaudeDesktopBackground(claude, processes.claudeDesktopBackgroundAgents);
      processes = {
        ...processes,
        claudeOpen: claude.activeAgents > 0,
        claudeAgents: claude.activeAgents,
      };
      const activeAgents = claude.activeAgents + (usage.codexActiveAgents || 0);
      presenceStartedAt = nextPresenceStartedAt(presenceStartedAt, activeAgents, checkedAt.valueOf());
      activity = buildPresence(processes, usage, {
        startedAt: presenceStartedAt,
        showAgentCount: settings.showAgentCount,
        showDailyTokens: settings.showDailyTokens,
        showWeeklyTokens: settings.showWeeklyTokens,
        stateUrl: profileStateUrl(settings, { discordUser: discord?.user || null }),
      });
      const desiredClientId = settings.clientId;
      if (!discord || discordClientId !== desiredClientId) {
        await discord?.close(true);
        discord = new DiscordIPC(desiredClientId);
        discordClientId = desiredClientId;
        lastActivity = "";
      }
      const serialized = JSON.stringify(activity);
      if (activity && serialized !== lastActivity) {
        await discord.setActivity(activity);
        lastActivity = serialized;
      } else if (!activity && discord && lastActivity) {
        await discord.setActivity(null);
        lastActivity = "";
      } else if (activity && !discord?.ready) {
        await discord.setActivity(activity);
      } else if (!activity && !discord?.ready) {
        await discord.connect();
      }
      discordConnected = Boolean(discord?.ready);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      await appendBoundedLog(paths.log, error);
    }
    const discordUser = settings.moreMetrics === true ? discord?.user || null : null;
    await writeStatus({
      running: true,
      pid: process.pid,
      checkedAt: checkedAt.toISOString(),
      discordConnected,
      discordUser,
      profile: profileSnapshot(settings, { discordUser }),
      vendors: {
        claude: (processes.claudeAgents || 0) > 0,
        codex: (usage.codexActiveAgents || 0) > 0,
      },
      activeAgents: (processes.claudeAgents || 0) + (usage.codexActiveAgents || 0),
      claudeActivity: claude,
      tokensToday: usage,
      image: activity?.assets?.large_image || null,
      activity: activity ? { details: activity.details, state: activity.state } : null,
      presenceStartedAt: presenceStartedAt ? new Date(presenceStartedAt).toISOString() : null,
      discordClientId,
      error,
    }, paths);
    if (!stopping) await wait(UPDATE_INTERVAL_MS);
  }
}
