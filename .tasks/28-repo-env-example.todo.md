# Task 28 — Repo: add .env.example to document required secrets

## Goal

New contributors and users have to grep the source to figure out which env vars
to set. Add a `.env.example` file at the repo root that documents every
secret/credential the project can use, with comments explaining each one.

This is a standard open source practice — when someone clones the repo, they
`cp .env.example .env` and fill in the blanks.

## Context

### How env vars work in this project

- The CLI auto-loads `.env` from the working directory (see `loadDotenv()` in
  `packages/cli/src/config-file.ts`)
- `.env` is in `.gitignore` — never committed
- Config values can be set three ways (in priority order):
  1. CLI flag (e.g. `--dd-api-key`)
  2. Environment variable (from `.env` or shell)
  3. `.sweny.yml` config file

### Provider → env var mapping

Each provider reads credentials from config, which the CLI populates from env
vars. Here are all the credentials needed for each provider option:

**Observability**
- `DATADOG_API_KEY` + `DATADOG_APP_KEY` + `DATADOG_SITE` (default: datadoghq.com)
- `SENTRY_AUTH_TOKEN` + `SENTRY_ORG`
- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_REGION` (CloudWatch)
- `SPLUNK_TOKEN` + `SPLUNK_URL`
- `ELASTIC_URL` + `ELASTIC_API_KEY`
- `NEW_RELIC_API_KEY`
- `LOKI_URL` (+ optional `LOKI_BASIC_AUTH`)

**Issue tracking**
- `GITHUB_TOKEN` (for github-issues provider)
- `LINEAR_API_KEY`
- `JIRA_URL` + `JIRA_EMAIL` + `JIRA_API_TOKEN`

**Source control**
- `GITHUB_TOKEN` (same token, reused for source-control-provider)
- `GITLAB_TOKEN` + `GITLAB_URL` (for self-hosted GitLab)

**Coding agent**
- `CLAUDE_CODE_OAUTH_TOKEN` (recommended — uses your Claude Max subscription)
- OR `ANTHROPIC_API_KEY` (pay-per-use API key)
- `OPENAI_API_KEY` (for codex provider)
- `GEMINI_API_KEY` (for gemini provider)

**Notification**
- `SLACK_WEBHOOK_URL` (for slack provider)
- `TEAMS_WEBHOOK_URL` (for teams provider)
- `DISCORD_WEBHOOK_URL` (for discord provider)
- `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL` (for email provider)

**GitHub MCP server** (optional, for enhanced GitHub context)
- `GITHUB_PERSONAL_ACCESS_TOKEN` (separate from GITHUB_TOKEN — needs read:repo scope)

### Verify by searching
If you want to double-check any of these, search for them in:
- `packages/providers/src/` — each provider file reads its config from a Zod schema
- `packages/cli/src/config.ts` — maps CLI flags to provider configs
- `packages/cli/src/main.ts` — any direct `process.env` reads

## What to write

Create `.env.example` at the repo root. Format:
- Group by provider category with `# === Category ===` headers
- Comment out all values (lines start with `#`)
- Each var gets a one-line description comment above it
- Show the "minimum to get started" at the top before the full list

### Top of file
```
# .env.example — copy to .env and fill in the values you need
# cp .env.example .env
#
# You only need to set the vars for the providers you're using.
# See .sweny.yml (created by `sweny init`) to select which providers to use.
#
# MINIMUM to run a local dry-run (no external services):
# Set CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY) and nothing else.
# Use observability-provider: file and issue-tracker-provider: file in .sweny.yml.
```

Then list all vars grouped by category.

## Done when

- [ ] `.env.example` exists at repo root
- [ ] "Minimum to get started" callout at the top
- [ ] All provider categories represented (observability, issue tracking, source control, coding agent, notification, MCP)
- [ ] Every var has a description comment
- [ ] All values are commented out (no actual secrets, all lines are `# VAR=value`)
- [ ] File is not added to `.gitignore` (it IS meant to be committed)
- [ ] No changeset needed (no published package modified)
