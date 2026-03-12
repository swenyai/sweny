# Recipe: Next.js + Datadog + Linear

For Next.js (or any Node.js) applications that send logs to Datadog and track engineering work in Linear. SWEny queries Datadog for error logs, investigates the root cause, creates a Linear issue, and optionally opens a fix PR.

## Stack

- **App**: Next.js / Node.js
- **Observability**: Datadog
- **Issue Tracker**: Linear
- **Source Control**: GitHub
- **Coding Agent**: Claude (default)

## Setup

### 1. Add `.sweny.yml` to your repo root

```yaml
# .sweny.yml
observability-provider: datadog
issue-tracker-provider: linear
source-control-provider: github
linear-team-id: your-linear-team-uuid
time-range: 24h
severity-focus: errors
review-mode: review
```

Key fields:

| Key | Description |
|-----|-------------|
| `linear-team-id` | Linear team UUID — find it in Linear under Team Settings → Copy team ID |
| `time-range` | How far back to look. `24h` is a good daily window; use `1h` for a high-frequency schedule. |
| `review-mode` | `review` (default) opens PR for human approval; `auto` enables GitHub auto-merge when CI passes. |

Optional fields for finer control:

```yaml
# .sweny.yml (extended)
observability-provider: datadog
dd-site: datadoghq.com          # or datadoghq.eu for EU region
issue-tracker-provider: linear
source-control-provider: github
linear-team-id: your-linear-team-uuid
linear-bug-label-id: your-bug-label-uuid
linear-triage-label-id: your-triage-label-uuid
linear-state-backlog: Backlog
linear-state-in-progress: In Progress
linear-state-peer-review: In Review
time-range: 24h
severity-focus: errors
service-filter: next-app
review-mode: review
```

### 2. Configure secrets

```bash
# .env  — never commit this file
ANTHROPIC_API_KEY=sk-ant-...
DD_API_KEY=abc123...
DD_APP_KEY=def456...
LINEAR_API_KEY=lin_api_...
GITHUB_TOKEN=ghp_...
```

| Variable | Where to get it |
|----------|-----------------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `DD_API_KEY` | Datadog → Organization Settings → API Keys |
| `DD_APP_KEY` | Datadog → Organization Settings → Application Keys |
| `LINEAR_API_KEY` | Linear → Settings → API → Personal API keys |
| `GITHUB_TOKEN` | Provided automatically in GitHub Actions |

### 3. Run locally

```bash
npx @sweny-ai/cli triage
```

## GitHub Actions

```yaml
# .github/workflows/triage.yml
name: SWEny Triage

on:
  schedule:
    - cron: "0 9 * * 1-5"   # weekdays at 09:00 UTC
  workflow_dispatch:

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: sweny-ai/sweny@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          observability-provider: datadog
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          dd-site: datadoghq.com
          issue-tracker-provider: linear
          linear-api-key: ${{ secrets.LINEAR_API_KEY }}
          linear-team-id: ${{ secrets.LINEAR_TEAM_ID }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          time-range: 24h
          severity-focus: errors
          review-mode: review
```

## What SWEny Does

1. Queries Datadog Logs for `status:error` logs in the configured time range.
2. Aggregates errors by service and selects the highest-impact issue.
3. Investigates the error — reads stack traces, traces, related log context from Datadog.
4. Checks Linear to see if the issue is already tracked (novelty mode).
5. If novel: creates a Linear issue in the configured team with full context.
6. If `review-mode: auto` and the fix is straightforward: opens a GitHub PR.

## Tips

- **Datadog site**: if your Datadog URL is `app.datadoghq.eu`, set `dd-site: datadoghq.eu` in `.sweny.yml`. The default is `datadoghq.com`.
- **Application Key scopes**: your `DD_APP_KEY` needs `logs_read_data` and `logs_read_index_data` permissions at minimum.
- **API Key scopes**: `DD_API_KEY` needs `logs_read` (read-only is fine — SWEny never writes to Datadog).
- **Linear UUIDs** for labels and states are required only if you want SWEny to apply specific labels. Omit them to use Linear's defaults.
- **`service-filter`** maps to the Datadog `service` tag. Set it to your app's service name (e.g., `next-app`, `api`) to avoid pulling in noise from unrelated services. Use `*` (default) to scan all services.
- **EU Datadog**: store `LINEAR_TEAM_ID` as a GitHub Actions secret rather than hardcoding it in `.sweny.yml` to keep team IDs out of source control.
