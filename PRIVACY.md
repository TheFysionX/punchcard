# Punchcard privacy model

Punchcard is local-first. The core package has no analytics endpoint, account system, advertising SDK, or bundled telemetry service.

## Data read locally

Punchcard reads only what it needs to calculate activity and numeric usage:

- Codex session JSONL files and the Codex state database for timestamps, lifecycle events, parent/sidechat relationships, and numeric token counts.
- Claude project JSONL files for timestamps, message identifiers, and numeric usage fields.
- Claude lifecycle marker files created by Punchcard's own user-level hooks.
- Operating-system process names, parent relationships, and command lines in memory so Claude Desktop working children can be distinguished from idle helpers and remote-control listeners.
- Punchcard's own settings and status files.

Parsing a JSONL record necessarily loads that local record in memory, but Punchcard does not copy, log, display, or transmit prompt text, responses, repository files, credentials, or conversation content.

## Data written locally

By default Punchcard writes under `~/.claude-codex-presence`:

- `settings.json`: user preferences and Discord application ID.
- `status.json`: the latest aggregate status and token totals.
- PID files for the daemon and Windows tray.
- Small Claude activity markers, removed when work stops or becomes stale.
- Update and optional-extension status files.
- `daemon.log` and `tray.log` for startup and unexpected errors only.

Each error log is capped at 256 KiB and keeps at most one tail backup capped at 128 KiB. Status and settings files are overwritten rather than appended. Punchcard does not create a historical database of prompts or presence updates.

If More Metrics is enabled, its separately installed files live under `~/.claude-codex-presence/extensions/more-metrics`. That extension is not part of the core package and has its own behavior and privacy boundary.

## Network and external disclosure

| Action | When it happens | Destination | Data involved |
| --- | --- | --- | --- |
| Discord Rich Presence | While Punchcard is enabled | Local Discord desktop IPC; Discord publishes the result | Platform label, active-agent count, token totals, elapsed start time, image key |
| Update check | Manually, or daily after automatic updates are enabled | `registry.npmjs.org` | Package name and normal HTTPS request metadata |
| Package update | Only after a manual update or opt-in automatic update finds a newer version | npm registry | Normal npm package-download metadata |
| More Metrics install | Only after the user enables More Metrics | npm registry | Request for the pinned `tag-plugin` package |
| Public profile | Only after an extension, base URL, and username are configured and the user clicks the button | The configured profile URL in the default browser | Username in the URL path and normal browser request metadata |

The Discord client and any optional extension are separate software. Their own terms and privacy policies govern what they do after Punchcard hands them data or starts them.

## Controls

- `punchcard presence-off` stops Discord activity while leaving the Windows tray available.
- `punchcard off` stops the daemon and tray, removes login startup, removes only Punchcard-tagged Claude hooks, and clears activity markers.
- `punchcard auto-update off` disables automatic npm update checks.
- `punchcard more-metrics off` removes the managed optional-extension directory.

Uninstalling the npm package does not itself remove startup configuration on every npm version. Run `punchcard off` first.

## Reports

If you find behavior that exceeds these boundaries, report it privately through [GitHub's vulnerability reporting form](https://github.com/TheFysionX/punchcard/security/advisories/new). Do not include private conversation files, tokens, or credentials.
