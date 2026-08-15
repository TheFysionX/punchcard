# Contributing to Punchcard

Thanks for helping improve Punchcard.

## Setup

Use Node.js 18 or newer. Install without lifecycle scripts so development setup does not modify startup entries or Claude settings:

```sh
npm install --ignore-scripts
```

## Before opening a pull request

```sh
npm test
npm run check
npm run release:check
```

The release check validates package metadata and syntax, creates the real npm tarball, confirms that development/debug files are excluded, installs it into an isolated temporary prefix with package scripts disabled, and runs the installed CLI.

Keep fixtures synthetic. Never commit real Codex or Claude transcripts, account identifiers, Discord data, credentials, machine-specific absolute paths, or npm tokens.

## Changes

- Keep activity counting evidence-based; an open application is not automatically an active agent.
- Preserve exact rolling token calculations. Do not estimate the week from today's rate.
- Keep network behavior opt-in and document any new destination or disclosed field in `docs/PRIVACY.md`.
- Do not make tests depend on a live Discord client or mutate the developer's real Codex/Claude directories.
- Update `CHANGELOG.md` for user-visible changes.

Bug fixes should include a regression test. Pull requests should explain the failure shape, the evidence used, and any local-format assumptions.
