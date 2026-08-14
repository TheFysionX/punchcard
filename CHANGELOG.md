# Changelog

All notable Punchcard changes are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-13

### Added

- Discord Rich Presence for Claude Code, Codex, and simultaneous mixed usage.
- Active main-agent, Claude subagent, Codex sidechat, and Claude Desktop background-work detection.
- Exact local token totals for today and a rolling seven-day window.
- Stable elapsed timer that resets only after activity reaches zero.
- Windows tray controls, cross-platform login startup, manual updates, and opt-in automatic updates.
- Optional, separately installed More Metrics integration.
- Bounded runtime error logs, privacy documentation, package smoke tests, and npm trusted-publishing workflow.

### Privacy

- Core operation remains local-first and does not upload prompt or repository contents.
- Dead localhost profile defaults were removed; the profile action is hidden until explicitly configured.

[1.0.0]: https://github.com/TheFysionX/punchcard/releases/tag/v1.0.0
