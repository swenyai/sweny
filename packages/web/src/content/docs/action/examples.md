---
title: Examples
description: Complete, copy-pasteable GitHub Actions workflow files for common SWEny configurations.
---

Every example below is a complete workflow file. Copy it into `.github/workflows/` in your repository, add the referenced secrets, and it works.

:::note[Which action?]
Triage and implement examples use [`swenyai/triage@v1`](https://github.com/swenyai/triage). Custom workflow examples use [`swenyai/sweny@v5`](https://github.com/swenyai/sweny). See [Action Setup](/action/) for the full breakdown.
:::

## Custom workflow (generic runner)

Run any workflow YAML built with `sweny workflow create`. This is the generic `swenyai/sweny@v5` action.

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

Secrets needed: `CLAUDE_CODE_OAUTH_TOKEN`.

## Minimal triage (Sentry + GitHub Issues)

The simplest possible setup. Sentry for error monitoring, GitHub Issues for tracking -- no extra services needed.

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 9 * * 1-5'
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

Secrets needed: `CLAUDE_CODE_OAUTH_TOKEN`, `SENTRY_AUTH_TOKEN`.

## Full stack (Datadog + Linear + Slack notification)

Production-grade setup with Datadog for observability, Linear for issue tracking, and Slack for team notifications.

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 9 * * 1-5'
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

          # Observability
          observability-provider: datadog
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}

          # Issue tracking
          issue-tracker-provider: linear
          linear-api-key: ${{ secrets.LINEAR_API_KEY }}
          linear-team-id: ${{ vars.LINEAR_TEAM_ID }}

          # Notifications
          notification-provider: slack
          notification-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}

          # Investigation
          time-range: 24h
          severity-focus: errors
          investigation-depth: standard
```

Secrets needed: `CLAUDE_CODE_OAUTH_TOKEN`, `DD_API_KEY`, `DD_APP_KEY`, `LINEAR_API_KEY`, `SLACK_WEBHOOK_URL`. Variable: `LINEAR_TEAM_ID`.

## Implement from a Linear issue

Skip log scanning and work directly on a known issue. Useful as a label-triggered workflow or manual dispatch.

```yaml
name: SWEny Implement
on:
  workflow_dispatch:
    inputs:
      issue:
        description: 'Linear issue identifier (e.g., ENG-123)'
        required: true
      instructions:
        description: 'Additional guidance for the agent'
        required: false

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  implement:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/triage@v1
        with:
          workflow: implement
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          linear-api-key: ${{ secrets.LINEAR_API_KEY }}
          linear-issue: ${{ inputs.issue }}
          additional-instructions: ${{ inputs.instructions }}
```

Secrets needed: `CLAUDE_CODE_OAUTH_TOKEN`, `LINEAR_API_KEY`.

## Multi-provider (Sentry for errors + Datadog for metrics)

Use Sentry as the primary observability provider and give the agent access to Datadog via MCP for additional metric context during investigation.

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 9 * * 1-5'
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

          # Primary: Sentry for error investigation
          observability-provider: sentry
          sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: my-org
          sentry-project: my-project

          # Additional: Datadog metrics via MCP
          mcp-servers: |
            {
              "datadog": {
                "type": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-datadog@latest"],
                "env": {
                  "DD_API_KEY": "${{ secrets.DD_API_KEY }}",
                  "DD_APP_KEY": "${{ secrets.DD_APP_KEY }}"
                }
              }
            }
```

Secrets needed: `CLAUDE_CODE_OAUTH_TOKEN`, `SENTRY_AUTH_TOKEN`, `DD_API_KEY`, `DD_APP_KEY`.

## Custom MCP servers

Add MCP servers to give the agent access to additional tools during investigation and implementation.

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 9 * * 1-5'
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
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}

          mcp-servers: |
            {
              "filesystem": {
                "type": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem@latest", "/workspace"]
              },
              "postgres": {
                "type": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-postgres@latest"],
                "env": {
                  "DATABASE_URL": "${{ secrets.DATABASE_URL }}"
                }
              }
            }
```

:::note[Auto-injected MCP servers]
SWEny automatically injects MCP servers for GitHub, Linear, and Datadog based on your configured providers. You do not need to add them manually via `mcp-servers`.
:::

## With workspace tools (Slack + Notion)

Enable workspace integrations to give the agent access to Slack messages and Notion documents during investigation.

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 9 * * 1-5'
  workflow_dispatch:

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
      NOTION_API_KEY: ${{ secrets.NOTION_API_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/triage@v1
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          workspace-tools: slack,notion
```

Each workspace tool requires its corresponding credential as an environment variable. The MCP server for each tool is injected automatically when both the tool name and the credential are present.

Secrets needed: `CLAUDE_CODE_OAUTH_TOKEN`, `DD_API_KEY`, `DD_APP_KEY`, `SLACK_BOT_TOKEN`, `NOTION_API_KEY`.

## Dry run

Analyze errors without creating any issues or PRs. Useful for validating your setup or running ad-hoc investigations.

```yaml
name: SWEny Dry Run
on:
  workflow_dispatch:
    inputs:
      time-range:
        description: 'Time window to analyze'
        required: false
        default: '24h'
        type: choice
        options: ['1h', '6h', '24h', '7d']
      investigation-depth:
        description: 'Investigation depth'
        required: false
        default: 'standard'
        type: choice
        options: ['quick', 'standard', 'thorough']

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

      - uses: swenyai/triage@v1
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          dry-run: true
          time-range: ${{ inputs.time-range }}
          investigation-depth: ${{ inputs.investigation-depth }}
```

In dry-run mode, SWEny writes its full investigation report to the GitHub Actions summary. No branches, no issues, no PRs -- just analysis.

:::note[Permissions in dry-run mode]
Dry runs only need `contents: read` and `issues: write` (for the summary). You can drop `pull-requests: write` and `contents: write`.
:::

## Vercel + GitHub Issues

For frontend teams using Vercel for hosting and observability.

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 9 * * 1-5'
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
          observability-provider: vercel
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-project-id: ${{ vars.VERCEL_PROJECT_ID }}
```

Secrets needed: `CLAUDE_CODE_OAUTH_TOKEN`, `VERCEL_TOKEN`. Variable: `VERCEL_PROJECT_ID`.

## GitLab source control with Jira

Use GitHub Actions for orchestration while targeting GitLab for source control and Jira for issue tracking.

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 9 * * 1-5'
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
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}

          # Source control
          source-control-provider: gitlab
          gitlab-token: ${{ secrets.GITLAB_TOKEN }}
          gitlab-project-id: my-group/my-project

          # Issue tracking
          issue-tracker-provider: jira
          jira-base-url: https://mycompany.atlassian.net
          jira-email: ${{ secrets.JIRA_EMAIL }}
          jira-api-token: ${{ secrets.JIRA_API_TOKEN }}
```

Secrets needed: `CLAUDE_CODE_OAUTH_TOKEN`, `DD_API_KEY`, `DD_APP_KEY`, `GITLAB_TOKEN`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.

## Auto-merge with safety rails

Enable auto-merge for low-risk fixes while keeping human review for anything dangerous.

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 9 * * 1-5'
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
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          review-mode: auto
          pr-labels: agent,triage,auto-fix
```

With `review-mode: auto`, SWEny enables GitHub auto-merge on the PR so it merges when CI passes. This is automatically suppressed for high-risk changes -- migrations, auth changes, lockfile modifications, or PRs touching more than 20 files -- which always require human review.

## Chaining triage and implement

Use outputs from the triage step to conditionally run implementation in the same workflow.

```yaml
name: SWEny Triage + Implement
on:
  schedule:
    - cron: '0 9 * * 1-5'
  workflow_dispatch:

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    outputs:
      recommendation: ${{ steps.sweny.outputs.recommendation }}
      issue-identifier: ${{ steps.sweny.outputs.issue-identifier }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/triage@v1
        id: sweny
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}

  implement:
    needs: triage
    if: needs.triage.outputs.recommendation == 'implement'
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/triage@v1
        with:
          workflow: implement
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          linear-issue: ${{ needs.triage.outputs.issue-identifier }}
```

The triage job investigates and creates an issue. If it recommends implementation, the second job picks up the issue and writes a fix PR.
