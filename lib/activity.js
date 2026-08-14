import { ASSET_KEYS } from "./constants.js";

export function formatTokens(value) {
  const tokens = Math.max(0, Math.round(Number(value) || 0));
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  if (tokens < 1_000_000_000) return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}M`;
  return `${(tokens / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

export function nextPresenceStartedAt(current, activeAgents, now = Date.now()) {
  if (activeAgents <= 0) return null;
  return Number.isFinite(current) ? current : now;
}

export function buildPresence(processes, usage, options = {}) {
  const hasClaude = Boolean((processes.claudeAgents || 0) > 0);
  const codexAgents = Math.max(0, usage.codexActiveAgents || 0);
  const hasCodex = Boolean(codexAgents > 0);
  if (!hasClaude && !hasCodex) return null;

  const agents = (processes.claudeAgents || 0) + codexAgents;
  const vendor = hasClaude && hasCodex ? "Claude & Codex" : hasClaude ? "Claude" : "Codex";
  const image = hasClaude && hasCodex ? ASSET_KEYS.mixed : hasClaude ? ASSET_KEYS.claude : ASSET_KEYS.codex;
  const details = options.showAgentCount === false
    ? vendor
    : `${vendor} • ${agents} agent${agents === 1 ? "" : "s"}`;
  const tokenParts = [];
  if (options.showDailyTokens !== false) tokenParts.push(`${formatTokens(usage.totalTokens)} today`);
  if (options.showWeeklyTokens !== false) tokenParts.push(`${formatTokens(usage.totalTokensWeek)} week`);
  return {
    type: 0,
    details,
    ...(tokenParts.length > 0 ? { state: `Tokens : ${tokenParts.join(" | ")}` } : {}),
    ...(tokenParts.length > 0 && typeof options.stateUrl === "string" && options.stateUrl
      ? { state_url: options.stateUrl }
      : {}),
    assets: {
      large_image: image,
      large_text: vendor,
    },
    ...(Number.isFinite(options.startedAt) ? { timestamps: { start: Math.floor(options.startedAt / 1000) } } : {}),
    instance: false,
  };
}
