# Changelog

All notable changes to this project will be documented in this file.

## [v1.1.1] — 2026-03-07

### Changed

- Renamed GitHub Action from "SWEny Triage" to "SWEny" — the action is the platform, not a single recipe. Marketplace listing moves to [github.com/marketplace/actions/sweny](https://github.com/marketplace/actions/sweny).

### Added

- **Self-triage workflow** — `.github/workflows/sweny-self.yml` runs SWEny against its own CI failure logs. Manual trigger only (maintainer-restricted). SWEny now dogfoods itself.

## [v1.1.0] — 2026-03-07

### Added

- **Multi-agent support** — `coding-agent-provider` input with `claude`, `codex`, and `gemini` options
- **Implement recipe** — engine now runs full investigate → implement → PR workflow end-to-end
- **File-based local providers** — zero-external-service quick start using local JSON log files
- **Engine step caching** — crash recovery and fast iteration with step-level cache
- **Action config validation** — Zod validation on all action inputs with clear error messages
- **`sentry-organization` input alias** — README now documents correct `sentry-org` input name

### Fixed

- **Missing env mappings** — `SENTRY_ORG`, `SENTRY_PROJECT`, `AWS_REGION`, `CLOUDWATCH_LOG_GROUP_PREFIX`, and `LOKI_ORG_ID` were not wired in CLI and action (Sentry, CloudWatch, and Loki users affected)
- **GitLab `baseBranch`** — base branch was not passed to GitLab PR creation
- **Security fixes** — hardened action inputs and engine execution

### Changed

- Migrated to `@anthropic-ai/claude-agent-sdk`
- Bumped `@actions/core`, `@actions/github`, `@actions/exec`, `@actions/io` to latest major versions
- Dependency security updates (commander, zod, @types/node)

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

## [v0.2.0] — 2026-02-28

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
- Added `exports` field to `@sweny-ai/agent` package.json
- Updated README with complete provider catalog

## [v0.1.0] — 2026-02-27

### Added

- Initial release
- **SWEny Triage** GitHub Action — autonomous SRE triage from observability logs
- **@sweny-ai/providers** — shared provider interfaces and implementations
  - Observability: Datadog, Sentry, CloudWatch
  - Issue tracking: Linear, GitHub Issues
  - Source control: GitHub
  - Notification: GitHub Summary, Slack, Teams, Discord webhooks
  - Incident: PagerDuty
  - Messaging: Slack
  - Storage: Filesystem, S3
  - Auth, access control, credential vault
  - Coding agent: Claude Code SDK wrapper
- **@sweny-ai/agent** — AI assistant framework with Slack bot + CLI
- **@sweny-ai/web** — Astro-based documentation site
- CI/CD workflows for lint, typecheck, test, release, and deploy
