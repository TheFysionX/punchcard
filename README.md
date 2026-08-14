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

<p align="center">
  <img src="assets/punchcard-mini-dashboard.png" width="368" alt="Punchcard mini dashboard on Windows">
</p>

## Commands

| Command | Description |
| --- | --- |
| `punchcard status` | View the current connection, agent, and usage status |
| `punchcard connect` | Open Discord if needed and reconnect Punchcard |
| `punchcard tray --show` | Open the Windows mini dashboard |
| `punchcard off` | Stop Punchcard and disable automatic startup |

## Advanced Metrics

Advanced Metrics is optional, disabled by default, and distributed separately from the core presence package.

```sh
punchcard more-metrics on
```

Enabling it installs [`punchcard-advanced-metrics`](https://www.npmjs.com/package/punchcard-advanced-metrics) into Punchcard's managed extensions directory. The companion package is maintained separately and is not part of this repository.

<p align="center">
  <img src="assets/punchcard-advanced-metrics.png" width="1000" alt="Punchcard Advanced Metrics dashboard">
</p>

Disable it at any time with:

```sh
punchcard more-metrics off
```

Punchcard is independent and is not affiliated with Anthropic, OpenAI, or Discord. Released under the [MIT License](LICENSE).
