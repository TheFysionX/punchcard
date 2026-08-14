<p align="center">
  <img src="assets/punchcard.svg" width="150" alt="Punchcard logo">
</p>

# Punchcard

Punchcard is a lightweight Discord Rich Presence for Claude Code and Codex. It shows when you are using either tool, how many agents are active, and how many tokens you have used.

<p align="center">
  <img src="assets/punchcard-discord-presence.png" width="405" alt="Punchcard activity displayed in Discord">
</p>

## Installing

Requires [Node.js 18 or newer](https://nodejs.org/) and the Discord desktop app.

```sh
npm install -g punchcard-presence
```

Punchcard starts automatically after installation. No API key, bot token, or Punchcard account is required.

Useful commands:

```sh
punchcard status
punchcard connect
punchcard tray --show
punchcard off
```

### Supported platforms

- **Windows 10/11:** Full support, including the native tray controls
- **macOS:** Background presence and login startup; no tray interface
- **Linux:** Background presence and login startup; no tray interface

## Features

- Discord Rich Presence for Claude Code, Codex, or both at once
- Active-agent count
- Tokens used today and over the last seven days
- Automatic Discord reconnection
- Native Windows tray controls and login startup
- Local-first tracking of usage and activity

<p align="center">
  <img src="assets/punchcard-mini-dashboard.png" width="368" alt="Punchcard mini dashboard on Windows">
</p>

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
