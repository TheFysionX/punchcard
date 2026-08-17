# Architecture

Punchcard is deliberately small and dependency-free. The global npm package contains one CLI, a background Node.js daemon, a Windows PowerShell tray, a macOS AppKit menu implemented with the system JXA runtime, and local product adapters.

## Runtime flow

```text
Codex local sessions + state DB -----> usage adapter ----+
                                                        |
Claude local sessions ----------------> usage adapter ----+--> activity formatter --> local Discord IPC
                                                        |
Claude lifecycle hooks ----------------> activity state --+
                                                        |
OS process snapshot -------------------> activity filter --+
```

Every 15 seconds the daemon refreshes local aggregate usage and active-agent state. The formatter produces one Discord activity only when at least one agent is active. A continuous nonzero period keeps one start timestamp; zero agents clears the activity and resets the timestamp.

## Boundaries

- `bin/cli.js`: lifecycle commands and user-facing status.
- `lib/usage.js`: token aggregation and Codex active-agent accounting.
- `lib/codex-sidechats.js`: read-only Codex sidechat relationship lookup.
- `lib/claude-activity.js` and `lib/claude-hooks.js`: Claude lifecycle markers, hook-independent workflow journals, direct subagent state, and hook ownership.
- `lib/processes.js`: in-memory process classification for Claude Desktop background work.
- `lib/activity.js`: Discord text, image, and elapsed-time formatting.
- `lib/discord-ipc.js`: local Discord IPC framing and reconnect behavior.
- `lib/state.js` and `lib/paths.js`: bounded local state surface.
- `lib/logging.js`: capped error-only runtime logs.
- `lib/updater.js`: read-only npm version lookup.
- `lib/autostart.js`: Windows Run-key, macOS LaunchAgent, and Linux desktop-entry lifecycle.
- `lib/tray.js`: tray lifecycle and Windows tray/daemon crash supervision.
- `lib/platform.js`: sanitized platform and prerequisite diagnostics.
- `lib/more-metrics.js`: explicit, separately installed optional extension boundary.
- `scripts/tray.ps1`: Windows-only settings and status UI.
- `scripts/tray-macos.js`: macOS menu-bar UI; it invokes the absolute Punchcard Node/CLI paths with `NSTask` and never a shell.

## Design invariants

1. An open app is not an active agent.
2. Token totals come from observed local numeric records, never an estimated rate.
3. Zero active agents means no visible Discord activity.
4. Refreshes do not reset the elapsed timer during continuous activity.
5. Core operation does not upload prompt or repository contents.
6. Development tools, tests, and debug monitors are excluded from the npm tarball.
7. User-owned Claude settings survive hook installation and removal; only Punchcard-tagged hooks are changed.
8. Quit exits cleanly without disabling login startup; Windows supervision and macOS launchd restart crashes, not intentional exits.

## Compatibility

Codex and Claude local files are implementation details rather than stable public APIs. Adapters should tolerate missing files and unknown record shapes without crashing the daemon. A parser change should include synthetic regression fixtures and must not log raw source records.

On macOS, Punchcard checks both currently observed Codex state database locations (`~/.codex/sqlite/state_5.sqlite` and the older top-level file), uses `CODEX_SQLITE_HOME` when supplied, and fails closed if neither schema is readable. Process enumeration uses separate `ps` identity and argument snapshots so application paths containing spaces are not truncated.
