import test from "node:test";
import assert from "node:assert/strict";
import { buildPresence, formatTokens, nextPresenceStartedAt } from "../lib/activity.js";

test("formats compact token counts", () => {
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_200), "1.2K");
  assert.equal(formatTokens(25_100), "25K");
  assert.equal(formatTokens(1_250_000), "1.3M");
});

test("uses the mixed asset, title, count, and stable timer", () => {
  const activity = buildPresence(
    { claudeOpen: true, claudeAgents: 1, codexOpen: true, codexCliAgents: 0 },
    { codexActiveAgents: 1, totalTokens: 12_345, totalTokensWeek: 987_654 },
    { startedAt: 1_750_000_000_000 },
  );
  assert.equal(activity.type, 0);
  assert.equal(activity.details, "Claude & Codex • 2 agents");
  assert.equal(activity.state, "Tokens : 12K today | 988K week");
  assert.equal(activity.assets.large_image, "claude-codex");
  assert.equal(activity.assets.large_text, "Claude & Codex");
  assert.equal(activity.timestamps.start, 1_750_000_000);
});

test("uses singular agent wording for one platform", () => {
  const activity = buildPresence(
    { claudeAgents: 0, codexCliAgents: 0 },
    { codexActiveAgents: 1, totalTokens: 10, totalTokensWeek: 20 },
  );
  assert.equal(activity.details, "Codex • 1 agent");
  assert.equal(activity.state, "Tokens : 10 today | 20 week");
});

test("independently hides agent count and either token window", () => {
  const weeklyOnly = buildPresence(
    { claudeAgents: 0, codexCliAgents: 0 },
    { codexActiveAgents: 2, totalTokens: 10, totalTokensWeek: 20 },
    { showAgentCount: false, showDailyTokens: false },
  );
  assert.equal(weeklyOnly.details, "Codex");
  assert.equal(weeklyOnly.state, "Tokens : 20 week");

  const dailyOnly = buildPresence(
    { claudeAgents: 1, codexCliAgents: 0 },
    { codexActiveAgents: 0, totalTokens: 10, totalTokensWeek: 20 },
    { showWeeklyTokens: false },
  );
  assert.equal(dailyOnly.details, "Claude • 1 agent");
  assert.equal(dailyOnly.state, "Tokens : 10 today");
});

test("omits the token line when both token windows are hidden", () => {
  const activity = buildPresence(
    { claudeAgents: 1, codexCliAgents: 0 },
    { codexActiveAgents: 0, totalTokens: 10, totalTokensWeek: 20 },
    { showDailyTokens: false, showWeeklyTokens: false },
  );
  assert.equal(activity.details, "Claude • 1 agent");
  assert.equal(Object.hasOwn(activity, "state"), false);
  assert.equal(Object.hasOwn(activity, "state_url"), false);
});

test("links the agent row to GitHub and the token row only to an opted-in profile", () => {
  const unlinked = buildPresence(
    { claudeAgents: 0, codexCliAgents: 0 },
    { codexActiveAgents: 1, totalTokens: 10, totalTokensWeek: 20 },
  );
  assert.equal(Object.hasOwn(unlinked, "state_url"), false);
  assert.equal(unlinked.details_url, "https://github.com/TheFysionX/punchcard");

  const linked = buildPresence(
    { claudeAgents: 0, codexCliAgents: 0 },
    { codexActiveAgents: 1, totalTokens: 10, totalTokensWeek: 20 },
    { stateUrl: "https://app.punchcardai.workers.dev/demo/stats" },
  );
  assert.equal(linked.state_url, "https://app.punchcardai.workers.dev/demo/stats");
  assert.equal(linked.details_url, "https://github.com/TheFysionX/punchcard");
});

test("keeps the agent row linked when both token windows are hidden", () => {
  const linked = buildPresence(
    { claudeAgents: 1, codexCliAgents: 0 },
    { codexActiveAgents: 0, totalTokens: 10, totalTokensWeek: 20 },
    {
      showDailyTokens: false,
      showWeeklyTokens: false,
      stateUrl: "https://app.punchcardai.workers.dev/demo/stats",
    },
  );
  assert.equal(linked.details_url, "https://github.com/TheFysionX/punchcard");
  assert.equal(Object.hasOwn(linked, "state_url"), false);
});

test("clears presence when neither product is open", () => {
  assert.equal(buildPresence(
    { claudeOpen: false, claudeAgents: 0, codexOpen: false, codexCliAgents: 0 },
    { codexActiveAgents: 0, totalTokens: 100 },
  ), null);
});

test("does not treat an idle Codex process as an active agent", () => {
  assert.equal(buildPresence(
    { claudeAgents: 0, codexOpen: true, codexCliAgents: 3 },
    { codexActiveAgents: 0, totalTokens: 100, totalTokensWeek: 200 },
  ), null);
});

test("resets the timer across an inactive period", () => {
  let startedAt = nextPresenceStartedAt(null, 2, 1_000);
  assert.equal(startedAt, 1_000);
  startedAt = nextPresenceStartedAt(startedAt, 1, 2_000);
  assert.equal(startedAt, 1_000);
  startedAt = nextPresenceStartedAt(startedAt, 0, 3_000);
  assert.equal(startedAt, null);
  startedAt = nextPresenceStartedAt(startedAt, 1, 4_000);
  assert.equal(startedAt, 4_000);
});
