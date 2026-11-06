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
          persist-credentials: false
          fetch-depth: 0

      - uses: swenyai/triage@v1
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
      - uses: swenyai/triage@v1
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
          persist-credentials: false
          fetch-depth: 0

      - uses: swenyai/triage@v1
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
          persist-credentials: false
          fetch-depth: 0

      - uses: swenyai/triage@v1
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          issue-override: '#${{ github.event.issue.number }}'
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
          persist-credentials: false
          fetch-depth: 0

      - uses: swenyai/triage@v1
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          issue-override: ${{ github.event.client_payload.issue }}
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
          persist-credentials: false
          fetch-depth: 0

      - uses: swenyai/triage@v1
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
          persist-credentials: false
          fetch-depth: 0

      - uses: swenyai/triage@v1
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          issue-override: '#${{ github.event.issue.number }}'
```

This creates a clean handoff: triage runs daily, finds issues, and creates tickets. When you are ready to fix one, add the `sweny-implement` label and SWEny writes the PR.

## Keep run history between runs

A runner starts clean every time, so `.sweny/runs/` is empty and `sweny runs diff` and the "since last run" line in the step summary have nothing to compare. The Action does not keep anything between runs on its own. History lives in the workspace at `<working-directory>/.sweny/runs`, not in the run journal's state dir; caching that one directory is enough.

```yaml
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false

      - uses: actions/cache/restore@v4
        with:
          path: .sweny/runs
          key: sweny-runs-${{ github.workflow }}-${{ github.run_id }}
          restore-keys: |
            sweny-runs-${{ github.workflow }}-

      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/competitive-scan.yml
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

      - uses: actions/cache/save@v4
        if: ${{ !cancelled() }}
        with:
          path: .sweny/runs
          key: sweny-runs-${{ github.workflow }}-${{ github.run_id }}
```

How it works:

- The key is new on every run, so every run saves. `restore-keys` restores the newest earlier cache for the same workflow, so the run starts with the previous history and adds its own record.
- The `cache/restore` and `cache/save` pair (instead of one `actions/cache` step) saves after a failed workflow too, so a failure is in the history.
- Set `path` to `<working-directory>/.sweny/runs` if you pass `working-directory`. Put the restore after checkout so the checkout does not clean it away.
- GitHub scopes caches by branch. A pull request restores from its base branch when it has none of its own, so the first PR run compares with the last run on the default branch.
- SWEny keeps the newest 200 runs and deletes older ones. GitHub evicts caches unused for 7 days; a weekly schedule stays warm.
- The cached directory holds each run's record, `output.md` and `answers.json`. They are redacted, but anything that can read your repository's caches can read them. Skip the cache for a workflow whose answers should not be visible to every repo collaborator, or run it with `--no-history`.

Then, in the step summary and PR comment: `Since last run: 2 added, 1 resolved`. Locally, or in a later job that restores the same cache, run `sweny runs diff` for the full comparison. See [`sweny runs`](/cli/commands/#sweny-runs).

## Best practices

- **Start with daily cron** and `dry-run: true`. Review the results for a week before enabling issue creation and PRs.
- **Match `time-range` to your schedule** to avoid duplicate investigations.
- **Always include `workflow_dispatch`** alongside `schedule` so you can trigger manually for debugging.
- **Set `timeout-minutes: 60`** (or higher for `thorough` depth) to give the agent enough time to complete.
- **Use `novelty-mode: true`** (the default) to skip issues that already have tickets, keeping your backlog clean.
