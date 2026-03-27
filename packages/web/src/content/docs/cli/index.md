---
title: CLI Quick Start
description: Install the SWEny CLI and run your first workflow in under a minute.
---

The SWEny CLI runs autonomous engineering workflows from your terminal. Use it to triage production errors, implement fixes for tracked issues, and build custom workflows -- no CI pipeline required.

## Install

```bash
npm install -g @sweny-ai/core
```

The binary is called `sweny`. You can also run it directly with `npx`:

```bash
npx @sweny-ai/core --help
```

:::note[Prerequisites]
You need a Claude Max subscription or an Anthropic API key (`ANTHROPIC_API_KEY`). The coding agent (Claude Code) is installed automatically at runtime.
:::

## Try it in 60 seconds

No external services needed -- just an API key and a log file.

**1. Create a config file:**

```bash
sweny init
```

This writes a starter `.sweny.yml` with all options commented out. Uncomment the local-only block:

```yaml
# .sweny.yml
observability-provider: file
log-file: ./sample-errors.json
issue-tracker-provider: file
source-control-provider: file
notification-provider: file
```

**2. Add your API key to `.env`:**

```bash
# .env (gitignored)
ANTHROPIC_API_KEY=sk-ant-...
```

The CLI auto-loads `.env` at startup -- no external dotenv tooling required.

**3. Run a dry-run triage:**

```bash
sweny triage --dry-run
```

SWEny reads `.sweny.yml`, loads secrets from `.env`, analyzes your logs, and writes results to `.sweny/output/` without creating any real issues or PRs.

## Live DAG rendering

When running on an interactive terminal, the CLI renders a live DAG showing workflow progress:

```
  Triage

  ┌──────────────────────────┐
  │ ● Fetch errors   12s     │
  └────────────┬─────────────┘
               │
  ┌────────────▼─────────────┐
  │ ◉ Investigate   2m 14s   │
  └────────────┬─────────────┘
               │
  ┌────────────▼─────────────┐
  │ ○ Create issues          │
  └──────────────────────────┘

  ● completed   ◉ running   ○ pending   ✕ failed
```

Status icons update in place as each node completes. Non-TTY environments (CI, pipes) get simple line-by-line output instead.

## Config priority

Settings resolve in this order (highest wins):

```
CLI flag  >  environment variable  >  .sweny.yml  >  default
```

Use flags for one-off overrides without editing your config file:

```bash
sweny triage --dry-run --time-range 1h --service-filter 'billing-*'
```

## Config file reference

`.sweny.yml` uses flat kebab-case keys that map 1:1 to CLI flags. You can copy any flag from `--help` directly into the YAML:

```yaml
# .sweny.yml -- commit this file. Secrets go in .env.

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
```

Secrets (API keys, tokens) are never read from the config file -- always use environment variables or `.env`.

## Connecting providers

Once local-only mode works, swap in real providers. Set the provider in `.sweny.yml` and add credentials to `.env`:

```yaml
# .sweny.yml
observability-provider: sentry
sentry-org: my-org
sentry-project: my-project
issue-tracker-provider: linear
linear-team-id: your-team-uuid
```

```bash
# .env
SENTRY_AUTH_TOKEN=sntrys_...
LINEAR_API_KEY=lin_api_...
GITHUB_TOKEN=ghp_...
```

Verify credentials before running a full workflow:

```bash
sweny check
```

See [Observability Providers](/providers/observability/) for all supported platforms.

## What's next?

- [Commands Reference](/cli/commands/) -- every command, flag, and option
- [Examples](/cli/examples/) -- common configurations and real-world recipes
