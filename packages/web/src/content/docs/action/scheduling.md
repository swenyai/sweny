---
title: Cron & Dispatch
description: Schedule automated triage and trigger workflows on demand.
---

SWEny becomes most powerful when it runs on autopilot. Put it on a cron schedule and it continuously monitors your production systems, triages errors, and opens fix PRs -- without anyone clicking a button.

## Cron scheduling

Use GitHub Actions `schedule` trigger to run triage on a recurring basis. The `cron` syntax uses UTC time.

### Daily at 9 AM UTC (weekdays only)

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

      - uses: swenyai/sweny@v4
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          time-range: 24h
```

### Every 6 hours

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:
```

With `time-range: 6h` to match:

```yaml
      - uses: swenyai/sweny@v4
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          time-range: 6h
```

### Twice a week (Monday and Thursday mornings)

```yaml
on:
  schedule:
    - cron: '0 6 * * 1,4'
  workflow_dispatch:
```

:::note[Match time-range to your schedule]
Set `time-range` to cover the window since the last run. Daily cron uses `24h`, every-6-hours uses `6h`, twice-weekly uses `4d`. This prevents re-investigating the same errors and avoids gaps in coverage.
:::

### Common cron patterns

| Pattern | Schedule |
|---------|----------|
| `0 9 * * 1-5` | Weekdays at 9:00 AM UTC |
| `0 */6 * * *` | Every 6 hours |
| `0 6 * * 1,4` | Monday and Thursday at 6:00 AM UTC |
| `0 0 * * *` | Daily at midnight UTC |
| `0 */2 * * *` | Every 2 hours |
| `30 8 * * 1-5` | Weekdays at 8:30 AM UTC |

:::note[GitHub cron scheduling]
GitHub Actions cron schedules can be delayed during periods of high load. Scheduled workflows run on the default branch only. Always include `workflow_dispatch` alongside `schedule` so you can trigger manually when needed.
:::

## Manual dispatch

The `workflow_dispatch` trigger lets you run triage on demand from the Actions tab. Add `inputs` to make it configurable:

```yaml
name: SWEny Triage
on:
  workflow_dispatch:
    inputs:
      time-range:
        description: 'Time window to analyze'
        required: false
        default: '24h'
        type: choice
        options: ['1h', '6h', '24h', '7d']
      dry-run:
        description: 'Analyze only, do not create issues or PRs'
        required: false
        default: false
        type: boolean
      service-filter:
        description: 'Service filter pattern'
        required: false
        default: '*'

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
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          time-range: ${{ inputs.time-range }}
          dry-run: ${{ inputs.dry-run }}
          service-filter: ${{ inputs.service-filter }}
```

This surfaces a form in the GitHub Actions UI where you can select the time range, toggle dry run, and filter services before running.

## Event-driven triggers

### Implement on issue label

Trigger the implement workflow automatically when a specific label is added to an issue:

```yaml
name: SWEny Implement
on:
  issues:
    types: [labeled]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  implement:
    if: github.event.label.name == 'sweny-implement'
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/sweny@v4
        with:
          workflow: implement
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          linear-issue: '#${{ github.event.issue.number }}'
```

Label an issue `sweny-implement` and SWEny picks it up, writes a fix, and opens a PR.

### Implement from repository dispatch

Use `repository_dispatch` to trigger implementations from external systems (webhooks, chatbots, other workflows):

```yaml
name: SWEny Implement
on:
  repository_dispatch:
    types: [sweny-implement]

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

      - uses: swenyai/sweny@v4
        with:
          workflow: implement
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          linear-issue: ${{ github.event.client_payload.issue }}
          additional-instructions: ${{ github.event.client_payload.instructions }}
```

Dispatch it with:

```bash
curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/OWNER/REPO/dispatches \
  -d '{"event_type": "sweny-implement", "client_payload": {"issue": "ENG-123"}}'
```

## Multiple workflows in one repo

The most common pattern: one workflow for automated triage on a schedule, and another for on-demand implementation.

### Triage workflow (cron)

```yaml
# .github/workflows/sweny-triage.yml
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

      - uses: swenyai/sweny@v4
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          time-range: 24h
```

### Implement workflow (label-triggered)

```yaml
# .github/workflows/sweny-implement.yml
name: SWEny Implement
on:
  issues:
    types: [labeled]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  implement:
    if: github.event.label.name == 'sweny-implement'
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/sweny@v4
        with:
          workflow: implement
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          linear-issue: '#${{ github.event.issue.number }}'
```

This creates a clean handoff: triage runs daily, finds issues, and creates tickets. When you are ready to fix one, add the `sweny-implement` label and SWEny writes the PR.

## Best practices

- **Start with daily cron** and `dry-run: true`. Review the results for a week before enabling issue creation and PRs.
- **Match `time-range` to your schedule** to avoid duplicate investigations.
- **Always include `workflow_dispatch`** alongside `schedule` so you can trigger manually for debugging.
- **Set `timeout-minutes: 60`** (or higher for `thorough` depth) to give the agent enough time to complete.
- **Use `novelty-mode: true`** (the default) to skip issues that already have tickets, keeping your backlog clean.
