# Changelog

All notable changes to this project will be documented in this file.

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
