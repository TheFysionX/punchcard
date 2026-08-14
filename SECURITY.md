# Security policy

## Supported versions

Security fixes are provided for the latest published major version.

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| Earlier prototypes | No |

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/TheFysionX/punchcard/security/advisories/new). Please include:

- the Punchcard, Node.js, and operating-system versions;
- the affected command or feature;
- minimal reproduction steps;
- the expected and observed security boundary; and
- a suggested mitigation, if known.

Do not open a public issue for an unpatched vulnerability. Do not include Discord credentials, npm tokens, private prompts, conversation logs, or repository contents.

You should receive an acknowledgement within seven days. A fix timeline depends on impact and reproducibility. Coordinated disclosure is appreciated.

## Scope

The core package, install/startup behavior, Claude hook management, local data parsing, Discord IPC, update mechanism, and managed optional-extension boundary are in scope. Vulnerabilities in Discord, npm, Claude, Codex, Node.js, or the separately installed `punchcard-advanced-metrics` package should also be reported to their respective maintainers.
