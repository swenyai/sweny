---
title: CLI Quick Start
description: Run SWEny triage workflows from your terminal.
---

The SWEny CLI lets you run triage workflows locally — no CI pipeline required. Use it to validate your setup, test against local log files, or run investigations on demand.

## Install

```bash
npm install -g @swenyai/cli
```

Or run directly with `npx`:

```bash
npx @swenyai/cli triage --help
```

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/overview) installed (`npm install -g @anthropic-ai/claude-code`)
- A Claude Max subscription or Anthropic API key
- A git repository with a remote (SWEny auto-detects `owner/repo` from your git remote)

## Quick start with a log file

The fastest way to try SWEny locally is with a JSON log file — no observability platform credentials needed.

**1. Create a log file** with entries matching this format:

```json
[
  {
    "timestamp": "2026-03-01T12:00:00Z",
    "service": "api-gateway",
    "level": "error",
    "message": "TypeError: Cannot read properties of undefined (reading 'userId')",
    "attributes": {
      "stack": "TypeError: Cannot read properties of undefined...",
      "path": "/api/v1/users/profile",
      "status_code": 500
    }
  }
]
```

**2. Set your auth** in the environment:

```bash
export CLAUDE_CODE_OAUTH_TOKEN="your-token"
# or
export ANTHROPIC_API_KEY="your-key"
```

**3. Run a dry-run triage:**

```bash
sweny triage \
  --observability-provider file \
  --log-file ./errors.json \
  --dry-run
```

SWEny will analyze the logs, investigate root causes, and print a full report — without creating any issues or PRs.

## Connecting to your observability platform

Once you're comfortable with the output, point SWEny at your real logs:

```bash
# Datadog
export DD_API_KEY="your-api-key"
export DD_APP_KEY="your-app-key"
sweny triage --observability-provider datadog --dry-run

# Sentry
export SENTRY_AUTH_TOKEN="your-token"
sweny triage \
  --observability-provider sentry \
  --sentry-org my-org \
  --sentry-project my-project \
  --dry-run
```

See [Observability Providers](/providers/observability/) for all supported platforms and their required credentials.

## Creating issues and PRs

Remove `--dry-run` and add a `GITHUB_TOKEN` to let SWEny create issues and open fix PRs:

```bash
export GITHUB_TOKEN="ghp_..."
sweny triage --observability-provider file --log-file ./errors.json
```

For Linear or Jira instead of GitHub Issues:

```bash
# Linear
export LINEAR_API_KEY="lin_api_..."
sweny triage \
  --issue-tracker-provider linear \
  --linear-team-id "your-team-uuid" \
  --observability-provider file \
  --log-file ./errors.json

# Jira
export JIRA_BASE_URL="https://mycompany.atlassian.net"
export JIRA_EMAIL="bot@mycompany.com"
export JIRA_API_TOKEN="your-token"
sweny triage \
  --issue-tracker-provider jira \
  --observability-provider file \
  --log-file ./errors.json
```

## JSON output

Use `--json` for machine-readable output — useful for piping to other tools or scripting:

```bash
sweny triage --dry-run --json | jq '.status'
```

## What's next?

- [CLI Inputs](/cli/inputs/) — full reference for all flags and environment variables
- [CLI Examples](/cli/examples/) — common configurations and recipes
- [Action Inputs](/action/inputs/) — equivalent GitHub Action configuration (the CLI mirrors these)
