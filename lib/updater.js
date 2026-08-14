const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isValidVersion(value) {
  return VERSION_PATTERN.test(String(value));
}

export function compareVersions(left, right) {
  const parse = (value) => {
    const [main, prerelease = ""] = String(value).split("-", 2);
    return { numbers: main.split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i += 1) {
    if ((a.numbers[i] || 0) !== (b.numbers[i] || 0)) return (a.numbers[i] || 0) > (b.numbers[i] || 0) ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export async function checkForUpdate({ packageName, currentVersion, fetchImpl = fetch, timeoutMs = 5_000 }) {
  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
    const latestVersion = String((await response.json()).version || "");
    if (!isValidVersion(latestVersion)) throw new Error("npm registry returned an invalid version");
    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      error: null,
    };
  } catch (caught) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
