<p align="center">
  <img src="assets/punchcard.svg" width="150" alt="Punchcard logo">
</p>

# Punchcard

Punchcard is a lightweight Discord Rich Presence for your Agentic Development Environments (ADEs). It shows when you are working with an ADE, how many agents are active, and how many tokens you have used.

<p align="center">
  <img src="assets/punchcard-discord-presence.png" width="405" alt="Punchcard activity displayed in Discord">
</p>

## Installing

Requires [Node.js 18 or newer](https://nodejs.org/) and the Discord desktop app.

```sh
npm install -g punchcard-presence
```

Punchcard starts automatically after installation. No API key, bot token, or Punchcard account is required.

### Supported platforms

- Codex
- Claude

Support for more ADEs is planned for the immediate future.

## Features

- Discord Rich Presence for Codex, Claude, or both at once
- Active agent count
- Daily and weekly token usage
- Automatic Discord reconnection
- Native Windows tray controls and login startup
- Local-first tracking of usage and activity

## Commands

| Command | Description |
| --- | --- |
| `punchcard on` | Enable and start Punchcard |
| `punchcard off` | Stop Punchcard and remove its startup entry and Claude hooks |
| `punchcard quit` | Close Punchcard without changing the Start with Windows setting |
| `punchcard toggle` | Switch Punchcard on or off |
| `punchcard connect` | Open Discord if needed and reconnect Punchcard |
| `punchcard status` | View the current connection, agent, and usage status |
| `punchcard doctor` | Print diagnostic status information |
| `punchcard restart` | Restart the daemon and tray |
| `punchcard tray --show` | Open the Windows mini dashboard |
| `punchcard startup <on\|off\|status>` | Manage Start with Windows |
| `punchcard auto-update <on\|off\|status>` | Manage automatic updates |
| `punchcard display status` | Show all Discord display settings |
| `punchcard display <agents\|daily\|weekly> <on\|off\|status>` | Manage the agent count and token totals shown in Discord |
| `punchcard more-metrics <on\|off\|status>` | Manage the optional Advanced Metrics extension from the CLI |
| `punchcard profile [--base-url URL]` | View the profile status or configure its host |
| `punchcard update-check` | Check for a newer version |
| `punchcard update` | Install the newest available version |
| `punchcard app [--id ID]` | View or change the Discord application ID |
| `punchcard --version` | Print the installed version |
| `punchcard help` | Show command-line help |

Add `--json` to `connect`, `status`, `display`, `more-metrics`, `profile`, or `update-check` for machine-readable output.

## Advanced Metrics

Advanced Metrics is optional, disabled by default, and distributed separately from the core presence package.

Open the Punchcard mini dashboard from the Windows tray and click the **More Metrics** checkbox highlighted below.

<p align="center">
  <img src="assets/punchcard-mini-dashboard.png" width="368" alt="More Metrics checkbox highlighted in the Punchcard mini dashboard">
</p>

Punchcard installs [`punchcard-advanced-metrics`](https://www.npmjs.com/package/punchcard-advanced-metrics) in the background. Once connected, click **View profile** to open your dashboard. The companion package is maintained separately and is not part of this repository.

<p align="center">
  <img src="assets/punchcard-advanced-metrics.png" width="1000" alt="Punchcard Advanced Metrics dashboard">
</p>

To disable Advanced Metrics, clear the **More Metrics** checkbox in the mini dashboard.

Punchcard is independent and is not affiliated with Anthropic, OpenAI, or Discord. Released under the [MIT License](LICENSE).
