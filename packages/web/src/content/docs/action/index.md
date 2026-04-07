---
title: GitHub Action Setup
description: Install and configure SWEny as a GitHub Action for autonomous triage and fix PRs.
---

The GitHub Action is how you deploy SWEny workflows to CI. Set up a cron schedule, forget about it, and wake up to triaged issues with fix PRs ready for review. Install it across multiple repos with service maps and it handles an entire team's worth of triage automatically.

Use the [CLI](/cli/) to build and test workflows locally, then deploy them here for automated, recurring runs. The Action connects to your observability platform, investigates errors, creates issue tickets, writes fixes, and opens pull requests -- all without human intervention.

## Prerequisites

- A GitHub repository
- An observability platform (Datadog, Sentry, CloudWatch, or [19 others](/action/inputs/#observability))
- SWEny uses [Claude](https://claude.ai/) as its AI engine — you'll need an [Anthropic API key](https://console.anthropic.com/) or a Claude OAuth token

That is it. SWEny uses **GitHub Issues** by default -- no extra issue tracker setup required.

## Minimal setup

Create `.github/workflows/sweny-triage.yml`:

```yaml
name: SWEny Triage
on:
  workflow_dispatch:

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

      - uses: swenyai/sweny@v5
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          observability-provider: sentry
          sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: my-org
          sentry-project: my-project
```

That is a complete, working workflow. Three secrets and you are running.

## Add secrets

In your repository **Settings > Secrets and variables > Actions**, add the credentials for your chosen provider:

| Secret | Where to get it |
|--------|----------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Max subscription > [OAuth token](https://docs.anthropic.com/en/docs/claude-code/overview) |
| `SENTRY_AUTH_TOKEN` | Sentry > Settings > Auth Tokens |

:::note[Claude Max vs API key]
Most users should use `claude-oauth-token` for predictable monthly cost. If you prefer pay-per-use billing, swap it for `anthropic-api-key` with an [Anthropic API key](https://console.anthropic.com/).
:::

The `GITHUB_TOKEN` is provided automatically by GitHub Actions -- you do not need to create it. SWEny uses it to create branches, issues, and pull requests.

## Required permissions

Your workflow needs these permissions for SWEny to create issues and PRs:

```yaml
permissions:
  contents: write       # Create branches and push commits
  issues: write         # Create and update issues
  pull-requests: write  # Open pull requests
```

For read-only analysis (dry run), `contents: read` and `issues: write` are sufficient.

## First run

1. Push the workflow file to your repository
2. Go to the **Actions** tab
3. Select "SWEny Triage" from the sidebar
4. Click **Run workflow**
5. Check the Actions summary for investigation results

For your first run, consider adding `dry-run: true` to analyze without creating any issues or PRs:

```yaml
      - uses: swenyai/sweny@v5
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          observability-provider: sentry
          sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: my-org
          sentry-project: my-project
          dry-run: true
```

Review the output, then remove `dry-run` and put it on a [schedule](/action/scheduling/).

## Switching observability providers

The example above uses Sentry. To use Datadog instead:

```yaml
      - uses: swenyai/sweny@v5
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          observability-provider: datadog
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
```

SWEny supports 21 observability providers including CloudWatch, Splunk, Elastic, New Relic, Loki, Vercel, Supabase, Fly.io, and more. See the full list in [Inputs & Outputs](/action/inputs/#observability).

## Using Linear or Jira instead of GitHub Issues

Set `issue-tracker-provider` and add the relevant credentials:

```yaml
      - uses: swenyai/sweny@v5
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          issue-tracker-provider: linear
          linear-api-key: ${{ secrets.LINEAR_API_KEY }}
          linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
```

For Jira:

```yaml
          issue-tracker-provider: jira
          jira-base-url: https://mycompany.atlassian.net
          jira-email: ${{ secrets.JIRA_EMAIL }}
          jira-api-token: ${{ secrets.JIRA_API_TOKEN }}
```

## What is next

- [Inputs & Outputs](/action/inputs/) -- full reference for every action input and output
- [Cron & Dispatch](/action/scheduling/) -- put triage on a schedule or trigger it from events
- [Service Map](/action/service-map/) -- scope triage to specific services and teams
- [Examples](/action/examples/) -- complete, copy-pasteable workflow files for common setups
