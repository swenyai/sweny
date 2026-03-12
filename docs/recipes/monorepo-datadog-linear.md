# Recipe: Monorepo + Datadog + Linear

For monorepos with multiple services — each owned by a different team — that send logs to Datadog and track work in Linear. Uses a service map to route findings to the right Linear team and code owners, and scopes investigation per service.

## Stack

- **App**: Monorepo (multiple services / packages)
- **Observability**: Datadog
- **Issue Tracker**: Linear
- **Source Control**: GitHub
- **Coding Agent**: Claude (default)

## Setup

### 1. Add `.sweny.yml` to your repo root

```yaml
# .sweny.yml
observability-provider: datadog
dd-site: datadoghq.com
issue-tracker-provider: linear
source-control-provider: github
linear-team-id: your-default-linear-team-uuid
time-range: 24h
severity-focus: errors
service-map-path: .github/service-map.yml
review-mode: review
```

Key fields:

| Key | Description |
|-----|-------------|
| `linear-team-id` | UUID of the default Linear team. Per-service teams are configured in the service map. |
| `service-map-path` | Path to the service ownership map (see step 2). Defaults to `.github/service-map.yml`. |
| `service-filter` | Omit (or set to `*`) to scan all services; set to a Datadog service tag to scope a single run. |

### 2. Create `.github/service-map.yml`

The service map tells SWEny which source paths and Linear team belong to each Datadog service tag.

```yaml
# .github/service-map.yml
version: 1

services:
  - name: api-gateway
    description: "Public-facing REST API — handles auth and routing"
    datadog_service: api-gateway        # matches the `service` tag in Datadog
    paths:
      - services/api-gateway/src/**
      - packages/shared/src/auth/**
    linear_team_id: eng-platform-team-uuid
    oncall: "@platform-team"

  - name: payments
    description: "Stripe integration and billing logic"
    datadog_service: payments-service
    paths:
      - services/payments/src/**
    linear_team_id: eng-payments-team-uuid
    oncall: "@payments-team"

  - name: worker
    description: "Background job processor (BullMQ)"
    datadog_service: worker
    paths:
      - services/worker/src/**
      - packages/queue/src/**
    linear_team_id: eng-platform-team-uuid
    oncall: "@platform-team"

  - name: frontend
    description: "Next.js frontend (Vercel)"
    datadog_service: frontend
    paths:
      - apps/web/src/**
    linear_team_id: eng-frontend-team-uuid
    oncall: "@frontend-team"
```

### 3. Configure secrets

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
| `DD_APP_KEY` | Datadog → Organization Settings → Application Keys (needs `logs_read_data`) |
| `LINEAR_API_KEY` | Linear → Settings → API → Personal API keys |
| `GITHUB_TOKEN` | Provided automatically in GitHub Actions |

### 4. Run locally

```bash
npx @sweny-ai/cli triage
```

## GitHub Actions

The recommended monorepo setup runs a single triage job that scans all services. For teams that want per-service isolation, see the matrix variant below.

### Single job (scan all services)

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
          linear-team-id: ${{ secrets.LINEAR_DEFAULT_TEAM_ID }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          service-map-path: .github/service-map.yml
          time-range: 24h
          severity-focus: errors
          review-mode: review
```

### Matrix variant (one job per service, parallel)

```yaml
# .github/workflows/triage.yml
name: SWEny Triage

on:
  schedule:
    - cron: "0 9 * * 1-5"
  workflow_dispatch:

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    strategy:
      fail-fast: false
      matrix:
        service: [api-gateway, payments-service, worker, frontend]
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
          linear-team-id: ${{ secrets.LINEAR_DEFAULT_TEAM_ID }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          service-map-path: .github/service-map.yml
          service-filter: ${{ matrix.service }}
          time-range: 24h
          severity-focus: errors
          review-mode: review
```

## What SWEny Does

1. Queries Datadog Logs for `status:error` logs across all services (or the filtered service) in the past 24 hours.
2. Aggregates error counts by Datadog `service` tag to find the highest-impact service.
3. Loads the service map to determine which source paths and Linear team own that service.
4. Investigates the top error — reads Datadog logs, traces, and the relevant source code paths.
5. Checks Linear for existing coverage of the issue (novelty mode).
6. If novel: creates a Linear issue in the service's owning team, tagged with the service name.
7. If `review-mode: auto` and the fix is low-risk: opens a pull request scoped to that service's paths.

## Tips

- **`datadog_service`** in the service map must exactly match the `service` tag your application sets in Datadog. Check it in Datadog under Service Catalog or the Log Explorer facet panel.
- **`linear_team_id`** in the service map overrides the top-level `linear-team-id` from `.sweny.yml`. The top-level value is the fallback for services not listed in the map.
- **Linear UUIDs**: get team UUIDs from Linear → Settings → Teams → click a team → the UUID is in the URL: `linear.app/your-org/settings/teams/<uuid>`.
- **Parallel matrix jobs** use one Linear issue per service run. If two services have related root causes (e.g., a shared library bug), SWEny's novelty mode will detect the duplicate on the second run.
- **`service-filter: *`** (the default) queries all Datadog services. This is fine for a single triage job but can be noisy in large orgs — scope to your highest-priority services first.
- **`dd-site`**: EU region users should set `dd-site: datadoghq.eu`. Other valid values: `us3.datadoghq.com`, `us5.datadoghq.com`, `ap1.datadoghq.com`.
- **`investigation-depth: thorough`** is useful for complex monorepo bugs where the root cause may span multiple packages. It allows more Claude turns but takes longer.
