---
title: GitHub Action Setup
description: Deploy SWEny workflows to CI — triage, e2e tests, or any custom workflow YAML.
---

SWEny ships three GitHub Actions. Pick the one that matches your use case:

| Action | Use case | Repo |
|--------|----------|------|
| [`swenyai/triage@v1`](https://github.com/swenyai/triage) | SRE triage — monitors alerts, files tickets, opens fix PRs | [swenyai/triage](https://github.com/swenyai/triage) |
| [`swenyai/e2e@v1`](https://github.com/swenyai/e2e) | Agentic E2E browser tests — AI drives a real browser, uploads screenshots | [swenyai/e2e](https://github.com/swenyai/e2e) |
| [`swenyai/sweny@v5`](https://github.com/swenyai/sweny) | Generic runner — execute any SWEny workflow YAML | this repo |

The **triage** and **e2e** actions are preset wrappers that auto-wire credentials, install dependencies, and expose a focused input surface. The **generic runner** takes any workflow YAML you build with `sweny workflow create`.

## Prerequisites

- A GitHub repository
- SWEny uses [Claude](https://claude.ai/) as its AI engine — you'll need an [Anthropic API key](https://console.anthropic.com/) or a Claude OAuth token
- For triage: an observability platform (Datadog, Sentry, CloudWatch, or [19 others](/action/inputs/#observability))

## Triage setup

The most common use case. Create `.github/workflows/sweny-triage.yml`:

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

      - uses: swenyai/triage@v1
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          observability-provider: sentry
          sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: my-org
          sentry-project: my-project
```

Three secrets and you are running. SWEny uses **GitHub Issues** by default -- no extra issue tracker setup required.

## Custom workflow setup

Run any workflow YAML built with `sweny workflow create`:

```yaml
name: Weekly Competitive Scan
on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/competitive-scan.yml
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

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
3. Select your workflow from the sidebar
4. Click **Run workflow**
5. Check the Actions summary for results

For triage, consider adding `dry-run: true` to analyze without creating any issues or PRs:

```yaml
      - uses: swenyai/triage@v1
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
      - uses: swenyai/triage@v1
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
      - uses: swenyai/triage@v1
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
- [`swenyai/triage` repo](https://github.com/swenyai/triage) -- triage preset action
- [`swenyai/e2e` repo](https://github.com/swenyai/e2e) -- E2E browser test action
