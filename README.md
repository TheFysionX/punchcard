# Punchcard

[![CI](https://github.com/TheFysionX/punchcard/actions/workflows/ci.yml/badge.svg)](https://github.com/TheFysionX/punchcard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claude-codex-presence)](https://www.npmjs.com/package/claude-codex-presence)
[![license](https://img.shields.io/npm/l/claude-codex-presence)](LICENSE)

Punchcard is a small, local-first Discord Rich Presence for Claude Code and Codex. It shows which platform is working, the number of active agents, today's token usage, and a real rolling seven-day total.

The Discord activity title stays **Punchcard**. Its two lines look like this:

```text
Claude & Codex · 3 agents
Tokens: 1.2M today | 4.8M week
```

When the active count reaches zero, Punchcard removes the activity and resets the elapsed timer. It reconnects automatically when work resumes.

## Requirements

- Node.js 18 or newer
- Discord desktop running on the same computer
- Claude Code, Codex, or both

Windows 10/11 gets the full tray interface. macOS and Linux run the same headless presence daemon and login-start integration, but do not currently include the tray UI.

## Install

```sh
npm install -g claude-codex-presence
```

That one global install starts Punchcard, configures user-level login startup, and adds the lifecycle hooks used to count Claude Code work. It does not require an API key, bot token, or Punchcard account.

If you prefer to inspect the package before allowing its install script to run:

```sh
npm install -g claude-codex-presence --ignore-scripts
punchcard on
```

## Commands

| Command | Purpose |
| --- | --- |
| `punchcard status` | Show the current connection, active-agent, and usage state |
| `punchcard on` | Enable and start Punchcard |
| `punchcard off` | Stop Punchcard and remove its login entry and Claude hooks |
| `punchcard toggle` | Switch Punchcard on or off |
| `punchcard restart` | Restart the background daemon |
| `punchcard connect` | Open Discord if needed and retry the local connection |
| `punchcard tray --show` | Open the Windows tray panel |
| `punchcard startup on\|off` | Control login startup |
| `punchcard auto-update on\|off` | Opt in or out of automatic npm updates |
| `punchcard update-check` | Check npm for a newer version |
| `punchcard update` | Install the newest verified npm version |
| `punchcard app --id ID` | Use a different Discord application ID |

Add `--json` to `status`, `connect`, `update-check`, or More Metrics commands when a machine-readable response is useful.

## What Punchcard counts

- **Codex:** active main tasks and sidechats from local session lifecycle records. Working sidechats remain active even when their parent is quiet; interrupted sidechats are excluded.
- **Claude Code:** main turns and subagents from user-level lifecycle hooks.
- **Claude Desktop:** a background agent only while it has a real working child process. Electron helpers, MCP servers, print children, and persistent remote-control listeners are excluded.
- **Tokens:** numeric usage records found in the local Codex and Claude data files. Claude records are deduplicated by message ID; inherited Codex prefixes and repeated cumulative snapshots are excluded.

The seven-day number is a rolling 7 x 24-hour window. It is not a calendar-week estimate and is never extrapolated from today's rate.

Local record formats can change without notice. Punchcard fails closed: an unknown format reports zero or unknown instead of inventing usage.

## Privacy and network behavior

Punchcard's core does not upload prompts, conversation text, repository contents, file contents, or credentials. It reads only the local lifecycle and numeric usage data needed for the presence, plus process metadata used to distinguish real work from idle helpers.

Punchcard connects to the Discord desktop client through local IPC; Discord then publishes the activity under your Discord privacy settings. Anyone allowed to see your activity can see the platform, agent count, token totals, and elapsed time.

Network access happens only for explicit or opt-in features: npm installation, update checks, package updates, and installation of the separate optional More Metrics extension. See [PRIVACY.md](PRIVACY.md) for the exact read, write, retention, and network boundaries.

## More Metrics

More Metrics is off by default and is not bundled with Punchcard. Enabling it installs the pinned `tag-plugin` package into Punchcard's managed local extensions directory with package scripts disabled. Removing it deletes that managed directory.

This extension is a separate product with its own behavior and privacy boundary. Review [`tag-plugin` on npm](https://www.npmjs.com/package/tag-plugin) before enabling it. The profile button remains hidden until the extension and a profile destination are both configured.

## Discord application

Punchcard ships with its public Discord application ID, so most users do not need to configure anything. The bold title is controlled by that Discord application; the platform label and logo change using the `codex`, `claude`, and `claude-codex` assets.

Developers can use their own Discord application:

```sh
punchcard app --id YOUR_DISCORD_APPLICATION_ID
```

Upload Rich Presence assets with the keys `codex`, `claude`, and `claude-codex` to that application.

## Troubleshooting

Start with:

```sh
punchcard doctor
```

- If Discord is disconnected, make sure the desktop client is running, then use `punchcard connect`.
- If activity is absent, confirm `Active agents` is greater than zero. An open but idle app intentionally does not count.
- If Claude activity is missing, run `punchcard restart` to reinstall the lifecycle hooks.
- If token totals look wrong, open a GitHub bug with sanitized `punchcard status --json` output. Do not attach conversation files.

## Uninstall

Run the cleanup command before removing the npm package:

```sh
punchcard off
npm uninstall -g claude-codex-presence
```

npm does not reliably run uninstall hooks. The explicit `off` command removes Punchcard's startup entry and only the Claude hooks tagged as Punchcard-owned.

## Development

```sh
npm install --ignore-scripts
npm test
npm run check
npm run release:check
```

Tests use isolated temporary directories and do not require or control Discord. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project status

Punchcard 1.0 targets the local file and process formats available at release time. Please report adapter breakage with product versions and sanitized diagnostics.

Punchcard is an independent project and is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, or Discord. Claude, Codex, Discord, and related marks belong to their respective owners.

Released under the [MIT License](LICENSE).
