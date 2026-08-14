# Changelog

## Unreleased

- Add an AppKit macOS menu-bar interface with all Punchcard settings and controls.
- Replace the always-running macOS LaunchAgent with a crash-only restart supervisor so Quit stays closed until the next login or manual start.
- Add current and legacy Codex state database discovery, macOS-safe process parsing, Application Support state storage with legacy continuity, and Unix npm-prefix discovery.
- Add macOS platform diagnostics plus generated-plist and JXA compilation checks on macOS CI.
- Pass launchd-safe Codex executable discovery into the optional Advanced Metrics collector.

## 1.0.5

- Count Codex desktop sidechat tabs as agents even though the app does not create rollout files or spawn-edge rows for them.

## 1.0.4

- Automatic updates now check every 15 minutes instead of once per day.
- Update checks use the tray's actual running version, so an updated package on disk cannot leave older live processes undetected.

## 1.0.3

- Updated More Metrics to `punchcard-advanced-metrics@1.0.1` for evidence-aware speed classification, safe historical replacement uploads, and improved model attribution.

## 1.0.2

- Moved Punchcard profile and More Metrics synchronization to `app.punchcardai.workers.dev`.

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
