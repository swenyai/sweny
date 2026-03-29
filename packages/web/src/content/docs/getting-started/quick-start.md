---
title: Quick Start
description: Get SWEny running in your repo in 5 minutes with the GitHub Action.
---

This guide sets up the **Triage** workflow as a GitHub Action. By the end, SWEny will automatically monitor your observability platform for errors, investigate root causes, create issues, and notify your team.

## Prerequisites

- A GitHub repository
- An observability platform (Sentry, Datadog, BetterStack, CloudWatch, Splunk, Elasticsearch, New Relic, or Grafana Loki)
- A [Claude Max](https://claude.ai/) subscription (recommended) or an [Anthropic API key](https://console.anthropic.com/)

## Step 1: Create the workflow file

Add `.github/workflows/sweny-triage.yml` to your repository:

```yaml
name: SWEny Triage
on:
  workflow_dispatch:  # manual trigger for testing
  schedule:
    - cron: '0 9 * * 1-5'  # weekdays at 9 AM UTC

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/sweny@v4
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          observability-provider: sentry
          sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: your-org
          sentry-project: your-project
```

:::note[Claude Max instead of API key]
If you have a Claude Max subscription, replace `anthropic-api-key` with `claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`. This gives you predictable monthly cost with no per-token billing.
:::

## Step 2: Add secrets

In your repository, go to **Settings > Secrets and variables > Actions** and add:

| Secret | Where to get it |
|--------|----------------|
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/) > API Keys |
| `SENTRY_AUTH_TOKEN` | Sentry > Settings > Auth Tokens |

Also set the `sentry-org` and `sentry-project` values in the workflow file to match your Sentry organization and project slugs.

### Using Datadog instead?

Replace the Sentry inputs with Datadog credentials:

```yaml
- uses: swenyai/sweny@v4
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    observability-provider: datadog
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
```

See [Action Inputs](/action/inputs/) for all supported observability providers and their required credentials.

## Step 3: Run it

Go to the **Actions** tab in your repository, select "SWEny Triage", and click **Run workflow**.

SWEny will:
1. Query your observability platform for recent errors
2. Investigate root causes using your codebase
3. Create GitHub Issues for novel, actionable problems
4. Post a summary to the GitHub Actions run

## Step 4: Check results

Open the completed workflow run. The **Summary** tab shows a structured report: which errors were found, what the root cause is, which issues were created, and which errors were skipped (duplicates or low priority).

:::note[Try dry-run first]
Add `dry-run: true` to review what SWEny finds before it takes any action. In dry-run mode, the executor runs the investigation nodes normally but stops at the first conditional routing decision — before any issues, PRs, or notifications are created. This is a hard gate enforced by the executor (not a prompt instruction), so there is zero risk of side effects. Remove `dry-run` once you are satisfied with the results.
:::

## What just happened?

SWEny ran the **Triage** workflow — an 8-node DAG:

1. **Prepare** — fetched any configured rules or context documents.
2. **Gather Context** — queried Sentry for unresolved errors and searched your GitHub repo for recent commits and related issues.
3. **Root Cause Analysis** — classified each issue as novel or duplicate, assessed severity and fix complexity, and produced a findings array.
4. **Routing** — Claude evaluated edge conditions: novel issues with severity medium or higher route to Create Issue; all duplicates or low-severity route to Skip.
5. **Create Issue** — filed GitHub Issues for novel findings and +1'd existing tickets for duplicates.
6. **Implement** — wrote a fix if the issue had a feasible fix approach (skipped for complex fixes).
7. **Open PR** — pushed a branch and opened a pull request.
8. **Notify Team** — posted a summary to the GitHub Actions run (the default notification provider).

Each node ran Claude with a focused instruction and only the tools it needed. The executor handled all routing, context passing, and event emission.

## Using Linear or Jira instead of GitHub Issues?

Set `issue-tracker-provider` and add the relevant credentials:

```yaml
- uses: swenyai/sweny@v4
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    observability-provider: sentry
    sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
    sentry-org: your-org
    sentry-project: your-project
    issue-tracker-provider: linear
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
```

See [Action Inputs](/action/inputs/) for Jira configuration.

## Adding Slack notifications

Add a webhook URL to get triage summaries in Slack:

```yaml
- uses: swenyai/sweny@v4
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    observability-provider: sentry
    sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
    sentry-org: your-org
    sentry-project: your-project
    notification-provider: slack
    notification-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
```

Discord and Teams webhooks work the same way — set `notification-provider` to `discord` or `teams`.

## What's next?

- **[End-to-End Walkthrough](/getting-started/walkthrough/)** — follow a real triage run from error spike to fix PR
- **[CLI Quick Start](/cli/)** — run SWEny locally from your terminal
- **[Studio](/studio/)** — visual workflow editor
- **[Action Inputs](/action/inputs/)** — time ranges, severity filters, investigation depth, and all other configuration
- **[Examples](/action/examples/)** — service filtering, specific issues, cross-repo dispatch
- **[SWEny Cloud](https://app.sweny.ai)** — managed dashboard with job history, team credentials, and analytics
