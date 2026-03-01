---
title: Quick Start
description: Get SWEny running in your repo in 5 minutes.
---

SWEny is a platform for building AI-powered engineering workflows that follow a **Learn → Act → Report** pattern. **SWEny Triage** is the first recipe -- it monitors your observability logs, investigates issues, creates tickets, and opens fix PRs. This guide walks through setting it up.

## Prerequisites

- A GitHub repository
- An observability platform — [Datadog](https://www.datadoghq.com/), [Sentry](https://sentry.io/), [CloudWatch](https://aws.amazon.com/cloudwatch/), [Splunk](https://www.splunk.com/), [Elasticsearch](https://www.elastic.co/), [New Relic](https://newrelic.com/), or [Grafana Loki](https://grafana.com/oss/loki/)
- A [Claude Max](https://claude.ai/) subscription (recommended) or an [Anthropic API key](https://console.anthropic.com/)

That's all you need to get started. SWEny uses **GitHub Issues** by default — no extra issue tracker setup required.

## Step 1: Try it (dry run)

Create `.github/workflows/sweny-triage.yml` in your repository:

```yaml
name: SWEny Triage
on:
  workflow_dispatch:  # Manual trigger

permissions:
  contents: read
  issues: write

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/sweny@v0.2
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          dry-run: true
```

### Add secrets

In your repository **Settings → Secrets and variables → Actions**, add:

| Secret | Where to get it |
|--------|----------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Max subscription → [OAuth token](https://docs.anthropic.com/en/docs/claude-code/overview) |
| `DD_API_KEY` | Datadog → Organization Settings → API Keys |
| `DD_APP_KEY` | Datadog → Organization Settings → Application Keys |

> **Why Claude Max?** Predictable monthly cost — no per-token billing surprises. If you prefer pay-per-use, swap `claude-oauth-token` for `anthropic-api-key` with an [Anthropic API key](https://console.anthropic.com/).

### Run it

Go to the **Actions** tab, select "SWEny Triage", and click **Run workflow**.

SWEny will analyze your Datadog logs and post a full investigation report in the GitHub Actions summary — no tickets, no PRs, just analysis. Review the output to see what it finds.

## Step 2: Turn it on

Once you're happy with the investigation quality, remove `dry-run`, add write permissions, and put it on a schedule:

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 6 * * 1,4'  # Mon & Thu at 6 AM UTC
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/sweny@v0.2
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
```

SWEny will now automatically investigate errors, create GitHub Issues with root cause analysis, write fixes, and open PRs.

## Using a different observability provider?

Swap out the Datadog inputs for your provider. See [Observability Providers](/providers/observability/) for Sentry, CloudWatch, Splunk, Elasticsearch, New Relic, and Loki configuration.

## Want Linear or Jira instead of GitHub Issues?

Set `issue-tracker-provider` and add the relevant credentials:

```yaml
# Linear
- uses: swenyai/sweny@v0.2
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
    issue-tracker-provider: 'linear'
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
```

See [Issue Tracking Providers](/providers/issue-tracking/) for full Linear, Jira, and GitHub Issues configuration.

## What's next?

- [Provider Architecture](/getting-started/providers/) — understand how SWEny's plugin system works
- [Action Inputs](/action/inputs/) — configure time ranges, severity filters, investigation depth
- [Examples](/action/examples/) — service filtering, specific issues, cross-repo dispatch
