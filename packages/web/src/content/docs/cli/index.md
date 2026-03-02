---
title: CLI Quick Start
description: Run SWEny triage workflows from your terminal.
---

The SWEny CLI lets you run triage workflows locally — no CI pipeline required. Use it to validate your setup, test against local log files, or run investigations on demand.

## Install

```bash
npm install -g @sweny-ai/cli
```

Or run directly with `npx`:

```bash
npx @sweny-ai/cli triage --help
```

## Prerequisites

- A Claude Max subscription or Anthropic API key
- A git repository with a remote (SWEny auto-detects `owner/repo` from your git remote)

The coding agent CLI (Claude Code by default) is installed automatically when you run the workflow — no manual pre-installation needed.

## Quick start

**1. Create a config file:**

```bash
sweny init
```

This creates `.sweny.yml` with all available options commented out. Uncomment and edit what you need:

```yaml
# .sweny.yml — commit this file. Secrets go in .env (gitignored).
observability-provider: file
log-file: ./logs/errors.json
```

**2. Add secrets to `.env`:**

```bash
# .env
CLAUDE_CODE_OAUTH_TOKEN=your-token
```

The CLI auto-loads `.env` at startup — no external tools needed.

**3. Run a dry-run triage:**

```bash
sweny triage --dry-run
```

SWEny reads settings from `.sweny.yml`, loads secrets from `.env`, analyzes your logs, and prints a full investigation report — without creating any issues or PRs.

### Config priority

Settings are resolved in this order (highest wins):

```
CLI flag  >  environment variable  >  .sweny.yml  >  default
```

Use flags for one-off overrides without editing your config file:

```bash
sweny triage --dry-run --time-range 1h --service-filter 'billing-*'
```

## Config file reference

`.sweny.yml` uses flat kebab-case keys that match CLI flags 1:1. You can copy any flag from `--help` directly into the YAML:

```yaml
# .sweny.yml

# Providers
observability-provider: datadog
issue-tracker-provider: github-issues
source-control-provider: github
coding-agent-provider: claude
notification-provider: console

# Investigation
time-range: 24h
severity-focus: errors
service-filter: "*"
investigation-depth: standard

# PR / branch
base-branch: main
pr-labels: agent,triage,needs-review

# Paths
service-map-path: .github/service-map.yml
log-file: ./logs/errors.json

# Cache
cache-dir: .sweny/cache
cache-ttl: 86400

# Provider-specific (non-secret)
dd-site: datadoghq.com
sentry-org: my-org
sentry-project: my-project
linear-team-id: your-team-uuid
```

Secrets (API keys, tokens) are **never** read from the config file — always use environment variables or `.env`.

## Connecting to your observability platform

Once you're comfortable with the output, point SWEny at your real logs. Set the provider in `.sweny.yml`:

```yaml
observability-provider: datadog
```

And add the credentials to `.env`:

```bash
# .env
DD_API_KEY=your-api-key
DD_APP_KEY=your-app-key
```

```bash
sweny triage --dry-run
```

See [Observability Providers](/providers/observability/) for all supported platforms and their required credentials.

## Creating issues and PRs

Remove `--dry-run` and add a `GITHUB_TOKEN` to let SWEny create issues and open fix PRs:

```bash
# .env
GITHUB_TOKEN=ghp_...
```

```bash
sweny triage
```

For Linear or Jira instead of GitHub Issues, set the provider in `.sweny.yml`:

```yaml
# Linear
issue-tracker-provider: linear
linear-team-id: your-team-uuid
```

```yaml
# Jira
issue-tracker-provider: jira
```

And add the credentials to `.env`:

```bash
# Linear
LINEAR_API_KEY=lin_api_...

# Jira
JIRA_BASE_URL=https://mycompany.atlassian.net
JIRA_EMAIL=bot@mycompany.com
JIRA_API_TOKEN=your-token
```

## Step caching

The CLI caches successful step results to disk. If the workflow crashes or you cancel mid-run, re-running replays cached steps instantly instead of re-executing expensive operations like `investigate` (which can take 3+ minutes):

```
First run:
  ✓ [3/9] investigate         3m 6s   → result cached

Re-run (same config):
  ↻ [3/9] investigate         cached  → replayed from disk
```

Cache is keyed on your config — changing providers, time range, or other settings produces a fresh cache. Caching is enabled by default.

| Flag | Description | Default |
|------|-------------|---------|
| `--cache-dir` | Cache directory | `.sweny/cache` |
| `--cache-ttl` | TTL in seconds (0 = infinite) | `86400` (24h) |
| `--no-cache` | Disable caching entirely | — |

You can also set `cache-dir` and `cache-ttl` in `.sweny.yml`.

## JSON output

Use `--json` for machine-readable output — useful for piping to other tools or scripting:

```bash
sweny triage --dry-run --json | jq '.status'
```

## What's next?

- [CLI Inputs](/cli/inputs/) — full reference for all flags and environment variables
- [CLI Examples](/cli/examples/) — common configurations and recipes
- [Action Inputs](/action/inputs/) — equivalent GitHub Action configuration (the CLI mirrors these)
