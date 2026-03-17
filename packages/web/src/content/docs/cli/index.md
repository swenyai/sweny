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

The coding agent CLI (Claude Code by default) is installed automatically when you run the workflow — no manual pre-installation needed.

## Try it in 60 seconds (local-only mode)

No external services needed — just an LLM API key and a log file:

```yaml
# .sweny.yml
observability-provider: file
log-file: ./sample-errors.json
issue-tracker-provider: file
source-control-provider: file
notification-provider: file
```

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npx @sweny-ai/cli triage --dry-run
```

Output goes to `.sweny/output/`:
- `issues/LOCAL-1.md` — Linear-style issue tickets
- `prs/pr-1.md` — GitHub-style PR descriptions
- `notifications/summary-*.md` — run summaries

When you're ready, swap in real providers (Datadog, GitHub, Linear, etc.) — the workflow is identical.

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

## Other commands

### sweny check

Verify that all configured providers can connect before running a full workflow.
Run this after initial setup to confirm credentials are correct:

```bash
sweny check
```

Checks each configured provider (observability, issue tracker, source control,
coding agent, notification) and prints ✓ / ✗ per provider with an actionable
error message and a link to get the missing credential.

### sweny implement

Implement a fix for an existing issue without running log investigation first.
Useful when you already know what needs fixing:

```bash
sweny implement --issue-identifier ENG-123
```

Fetches the issue from your tracker, investigates the codebase, implements a fix,
and opens a PR. Requires issue tracker, source control, and coding agent providers —
no observability provider needed.

### sweny workflow

Run, validate, export, and inspect custom workflow files.

**Run a workflow file with live output:**

```bash
sweny workflow run .sweny/workflows/my-workflow.yml
```

Streams live step-by-step output to stderr as the workflow runs:

```
  ▲ my-workflow

  ○ verify-setup…
  ✓ verify-setup  234ms
  ○ do-work…
  ✓ do-work  4.2s
  ○ notify…
  ✓ notify  180ms
```

Flags:
- `--dry-run` — validate without running
- `--steps <path>` — path to a JS module that registers custom step types
- `--json` — output result as JSON on stdout; suppress progress output

**Validate a workflow file without running it:**

```bash
sweny workflow validate .sweny/workflows/my-workflow.yml
# exits 0 if valid, 1 with errors if not — good for CI
```

**List all available step types:**

```bash
sweny workflow list
sweny workflow list --steps ./my-custom-steps.js  # include custom types
```

**Export a built-in workflow as YAML** (useful as a starting point for customization):

```bash
sweny workflow export triage > .sweny/workflows/triage.yml
sweny workflow export implement > .sweny/workflows/implement.yml
```

## What's next?

- [CLI Inputs](/cli/inputs/) — full reference for all flags and environment variables
- [CLI Examples](/cli/examples/) — common configurations and examples
- [Workflow Authoring](/studio/recipe-authoring/) — build custom workflows with your own steps
- [Action Inputs](/action/inputs/) — equivalent GitHub Action configuration (the CLI mirrors these)
