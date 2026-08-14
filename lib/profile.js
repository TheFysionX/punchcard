function cleanPublicText(value, maximum = 80) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/u.test(cleaned)) return null;
  return cleaned;
}

export const DEFAULT_PROFILE_BASE_URL = "https://app.punchcardai.workers.dev";

export function normalizeProfileBaseUrl(value) {
  const candidate = cleanPublicText(value, 512);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/$/u, "");
  } catch {
    return null;
  }
}

export function profileSnapshot(settings = {}, status = {}, env = process.env) {
  const enabled = settings.moreMetrics === true;
  const username = enabled ? cleanPublicText(status.discordUser?.username) : null;
  const baseUrl = normalizeProfileBaseUrl(env.PUNCHCARD_PROFILE_BASE_URL)
    || normalizeProfileBaseUrl(settings.profileBaseUrl)
    || DEFAULT_PROFILE_BASE_URL;
  return {
    username,
    displayName: enabled ? cleanPublicText(status.discordUser?.displayName) || username : null,
    baseUrl,
    url: username && baseUrl ? `${baseUrl}/${encodeURIComponent(username)}/stats` : null,
  };
}

export function profileStateUrl(settings = {}, status = {}, env = process.env) {
  if (settings.moreMetrics !== true || settings.showProfileInStatus !== true) return null;
  return profileSnapshot(settings, status, env).url;
}
