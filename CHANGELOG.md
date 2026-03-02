# Changelog

All notable changes to this project will be documented in this file.

## [v0.2.1] — 2026-03-02

### Added

- **`.sweny.yml` config file** — project-level configuration so `sweny triage --dry-run` works without dozens of flags
- **`sweny init` command** — scaffolds a starter config file with all options documented
- **Auto `.env` loading** — CLI loads `.env` at startup, no external tools needed
- **Step-level caching** — cached step results replay on re-run for crash recovery and fast iteration (`--cache-dir`, `--cache-ttl`, `--no-cache`)
- **Multi-agent support** — `--coding-agent-provider` flag with `claude`, `codex`, and `gemini` options
- **CLI spinner UX** — animated progress with step counter `[N/9]`, phase headers, and status folding
- **`--bell` flag** — terminal bell on completion
- **Quiet mode** for coding agents — suppresses agent stdout in CLI output
- **Channel-native notifications** — Slack Block Kit, Teams Adaptive Cards, Discord embeds, HTML email

### Changed

- Provider logs routed through shared spinner-aware logger
- Config priority: CLI flag > env var > `.sweny.yml` > default

## [v0.2] — 2026-02-28

### Added

- **7 new providers:** Splunk, Elasticsearch, Grafana Loki, New Relic, GitLab, OpsGenie, Microsoft Teams
- **AWS Secrets Manager** credential vault provider
- **Kubernetes CSI** storage provider
- **Jira** issue tracking provider
- Husky + lint-staged pre-commit hooks
- JSDoc documentation on all provider interfaces
- Zod config validation for all providers
- 201 test files with comprehensive coverage across all packages

### Changed

- Reduced ESLint warnings from 173 to 18
- Added `exports` field to `@swenyai/agent` package.json
- Updated README with complete provider catalog

## [v0.1] — 2026-02-27

### Added

- Initial release
- **SWEny Triage** GitHub Action — autonomous SRE triage from observability logs
- **@swenyai/providers** — shared provider interfaces and implementations
  - Observability: Datadog, Sentry, CloudWatch
  - Issue tracking: Linear, GitHub Issues
  - Source control: GitHub
  - Notification: GitHub Summary, Slack, Teams, Discord webhooks
  - Incident: PagerDuty
  - Messaging: Slack
  - Storage: Filesystem, S3
  - Auth, access control, credential vault
  - Coding agent: Claude Code SDK wrapper
- **@swenyai/agent** — AI assistant framework with Slack bot + CLI
- **@swenyai/web** — Astro-based documentation site
- CI/CD workflows for lint, typecheck, test, release, and deploy
