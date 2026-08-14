# Changelog

## 1.0.2

- Added an opt-in **Show my profile in my status** control beneath More Metrics.
- The Discord token line links to the user's Punchcard profile only while that control is enabled. No profile URL is sent in the activity otherwise.
- Disabling More Metrics now clears the profile-link preference automatically.
- Discord refreshes preserve the current activity timer and remain available while connected.
- Moved profile and More Metrics traffic to `app.punchcardai.workers.dev`.

## 1.0.1

- More Metrics now uploads signed, content-free daily aggregates to Punchcard's Cloudflare D1 backend.
- Removed the local historical metrics snapshot; only cursors, signing state, and one retry batch remain locally.
- Added the default public profile at the deployed Punchcard Cloudflare Worker.
- Updated the optional metrics dependency to `punchcard-advanced-metrics@1.0.0`.

All notable Punchcard changes are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-13

### Added

- Discord Rich Presence for Claude Code, Codex, and simultaneous mixed usage.
- Active main-agent, Claude subagent, Codex sidechat, and Claude Desktop background-work detection.
- Exact local token totals for today and a rolling seven-day window.
- Stable elapsed timer that resets only after activity reaches zero.
- Windows tray controls, cross-platform login startup, manual updates, and opt-in automatic updates.
- Optional, separately installed More Metrics integration.
- Optional profile handoff that resolves the current public Discord username locally and remains hidden until its extension and destination are configured.
- Bounded runtime error logs, privacy documentation, package smoke tests, and npm trusted-publishing workflow.

### Privacy

- Core operation remains local-first and does not upload prompt or repository contents.
- Dead localhost profile defaults were removed; the profile action is hidden until explicitly configured.

[1.0.0]: https://github.com/TheFysionX/punchcard/releases/tag/v1.0.0
