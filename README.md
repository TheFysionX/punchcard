<p align="center">
  <img src="assets/punchcard.svg" width="150" alt="Punchcard logo">
</p>

# Punchcard

Punchcard is a completely free, lightweight Discord Rich Presence for your Agentic Development Environments (ADEs). No API key, account, or setup is required. It shows when you are working with an ADE, how many agents are active, and how many tokens you have used.

<p align="center">
  <img src="assets/punchcard-discord-presence.png" width="405" alt="Punchcard activity displayed in Discord">
</p>

## Installing

Requires [Node.js 18 or newer](https://nodejs.org/) and the Discord desktop app.

Punchcard supports Windows, macOS, and headless Linux desktop sessions. macOS uses a native AppKit menu-bar item and a user LaunchAgent; see the [macOS support guide](docs/MACOS.md) for platform details and troubleshooting checks.

```sh
npm install -g punchcard-presence
```

If you would prefer to use an agent or AI, paste this:

```text
Read https://github.com/TheFysionX/punchcard and install Punchcard.
```

Punchcard starts automatically after installation.

### Supported platforms

- Codex
- Claude

Support for more ADEs is planned for the immediate future.

## Features

- Discord Rich Presence for Codex, Claude, or both at once
- Active agent count
- Daily and weekly token usage
- Optional profile link on the Discord token line
- Automatic Discord reconnection
- Native Windows tray or macOS menu-bar controls and login startup
- Local-first tracking of usage and activity

## Commands

Punchcard starts automatically. These are the only commands most people may need:

| Command | Description |
| --- | --- |
| `punchcard on` | Enable and start Punchcard |
| `punchcard off` | Stop Punchcard and remove its startup entry and Claude hooks |
| `punchcard quit` | Close Punchcard without changing the Start with Windows setting |
| `punchcard connect` | Open Discord if needed and reconnect Punchcard |
| `punchcard status` | View the current connection, agent, and usage status |
| `punchcard restart` | Restart the daemon and tray |
| `punchcard tray --show` | Open the Windows tray panel or macOS menu-bar item |
| `punchcard help` | Show command-line help |

## Advanced Metrics

Advanced Metrics is optional, disabled by default, and distributed separately from the core presence package.

Open Punchcard from the Windows tray or macOS menu bar and click the **More Metrics** checkbox highlighted below.

<p align="center">
  <img src="assets/punchcard-mini-dashboard.png" width="368" alt="More Metrics checkbox highlighted in the Punchcard mini dashboard">
</p>

Punchcard installs [`punchcard-advanced-metrics`](https://www.npmjs.com/package/punchcard-advanced-metrics) in the background. Once connected, click **View profile** to open your dashboard. The companion package is maintained separately and is not part of this repository.

After More Metrics is enabled, Punchcard shows a nested **Show my profile in my status** checkbox. It is off by default. Enabling it makes the token line in Discord clickable and sends people to your Punchcard profile. When it is off, Punchcard does not include a profile URL in the Discord activity.

<p align="center">
  <img src="assets/punchcard-advanced-metrics.png" width="1000" alt="Punchcard Advanced Metrics dashboard">
</p>

To disable Advanced Metrics, clear the **More Metrics** checkbox in the mini dashboard.

Punchcard is independent and is not affiliated with Anthropic, OpenAI, or Discord. Released under the [MIT License](LICENSE).
