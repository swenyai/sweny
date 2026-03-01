---
title: Quick Start
description: Get SWEny running in your repo in 5 minutes.
---

SWEny is a platform for building AI-powered engineering workflows that follow a **Learn → Act → Report** pattern. **SWEny Triage** is the first recipe -- it monitors your observability logs, investigates issues, creates tickets, and opens fix PRs. This guide walks through setting it up.

## Prerequisites

- A GitHub or GitLab repository
- An observability platform — [Datadog](https://www.datadoghq.com/), [Sentry](https://sentry.io/), [CloudWatch](https://aws.amazon.com/cloudwatch/), [Splunk](https://www.splunk.com/), [Elasticsearch](https://www.elastic.co/), [New Relic](https://newrelic.com/), or [Grafana Loki](https://grafana.com/oss/loki/)
- An issue tracker — [Linear](https://linear.app/), GitHub Issues, or [Jira](https://www.atlassian.com/software/jira)
- Source control — GitHub or [GitLab](https://gitlab.com/)
- A Claude Code OAuth token (from a Claude Max / Pro subscription) or an Anthropic API key

This guide uses **Datadog + Linear** as the default walkthrough. See [Observability Providers](/providers/observability/), [Issue Tracking Providers](/providers/issue-tracking/), and [Source Control Providers](/providers/source-control/) for alternatives.

## Add the workflow

Create `.github/workflows/sweny-triage.yml` in your repository:

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 6 * * 1,4'  # Mon & Thu at 6 AM UTC
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/sweny@v0.1
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          linear-api-key: ${{ secrets.LINEAR_API_KEY }}
          linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
          linear-bug-label-id: ${{ vars.LINEAR_BUG_LABEL_ID }}
          linear-triage-label-id: ${{ vars.AGENT_TRIAGE_LABEL_ID }}
```

## Add secrets

In your repository settings, add these secrets:

| Secret | Where to get it |
|--------|----------------|
| `CLAUDE_OAUTH_TOKEN` | Claude Max/Pro subscription token |
| `DD_API_KEY` | Datadog > Organization Settings > API Keys |
| `DD_APP_KEY` | Datadog > Organization Settings > Application Keys |
| `LINEAR_API_KEY` | Linear > Settings > API > Personal API keys |

And these variables:

| Variable | Where to get it |
|----------|----------------|
| `LINEAR_TEAM_ID` | Linear team UUID (from the URL or API) |
| `LINEAR_BUG_LABEL_ID` | UUID of your "Bug" label in Linear |
| `AGENT_TRIAGE_LABEL_ID` | UUID of your "Agent Triage" label in Linear (create one if needed) |

## Run it

Trigger the workflow manually from the Actions tab, or wait for the next scheduled run.

SWEny will:
1. Query Datadog for errors in the last 24 hours
2. Analyze them and identify the highest-impact novel issue
3. Create a Linear ticket with root cause analysis
4. Write a fix and open a PR
5. Post a summary to the GitHub Actions run

## What's next?

- [End-to-End Walkthrough](/getting-started/walkthrough/) — see a real triage run from error spike to merged PR
- [Provider Architecture](/getting-started/providers/) — understand how SWEny's plugin system works
- [Action Inputs](/action/inputs/) — configure time ranges, severity filters, investigation depth
- [Examples](/action/examples/) — dry runs, specific issues, service filtering
