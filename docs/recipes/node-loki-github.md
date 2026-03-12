# Recipe: Node.js Microservice + Loki + GitHub Issues

For Node.js services (Express, Fastify, NestJS, etc.) that ship logs to Grafana Loki — whether self-hosted or via Grafana Cloud. SWEny queries Loki using LogQL, investigates errors, and opens GitHub Issues (and optionally fix PRs).

## Stack

- **App**: Node.js (Express / Fastify / NestJS / etc.)
- **Observability**: Grafana Loki
- **Issue Tracker**: GitHub Issues
- **Source Control**: GitHub
- **Coding Agent**: Claude (default)

## Setup

### 1. Add `.sweny.yml` to your repo root

```yaml
# .sweny.yml
observability-provider: loki
issue-tracker-provider: github-issues
source-control-provider: github
time-range: 24h
severity-focus: errors
review-mode: review
```

Loki connection details come from environment variables (see step 2) — there are no Loki-specific keys in `.sweny.yml`.

Optional fields you can add:

```yaml
# .sweny.yml (extended)
observability-provider: loki
issue-tracker-provider: github-issues
source-control-provider: github
time-range: 24h
severity-focus: errors
service-filter: my-node-service   # scopes LogQL job label query
review-mode: review
base-branch: main
pr-labels: agent,triage,needs-review
```

### 2. Configure secrets

```bash
# .env  — never commit this file
ANTHROPIC_API_KEY=sk-ant-...
LOKI_URL=https://loki.yourcompany.com
LOKI_API_KEY=glc_...               # optional — omit for unauthenticated Loki
LOKI_ORG_ID=your-tenant-id         # optional — required for multi-tenant Loki
GITHUB_TOKEN=ghp_...
```

| Variable | Where to get it | Required? |
|----------|-----------------|-----------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Yes |
| `LOKI_URL` | Your Loki base URL, e.g. `https://logs-prod-006.grafana.net` | Yes |
| `LOKI_API_KEY` | Grafana Cloud: stack → Access Policies → create token with `logs:read` scope. Self-hosted: omit if unauthenticated. | If auth required |
| `LOKI_ORG_ID` | Required for multi-tenant Loki (passed as `X-Scope-OrgID` header). Grafana Cloud uses your numeric stack ID. | If multi-tenant |
| `GITHUB_TOKEN` | Provided automatically in GitHub Actions | Yes (in CI) |

#### Grafana Cloud Loki URL

Your Loki URL is visible in Grafana Cloud under **Home → Connections → Data sources → Loki → Connection**. It looks like:

```
https://logs-prod-006.grafana.net
```

The `LOKI_ORG_ID` for Grafana Cloud is your numeric Grafana stack ID (also shown on the data source page).

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
          observability-provider: loki
          loki-url: ${{ secrets.LOKI_URL }}
          loki-api-key: ${{ secrets.LOKI_API_KEY }}
          loki-org-id: ${{ secrets.LOKI_ORG_ID }}
          issue-tracker-provider: github-issues
          github-token: ${{ secrets.GITHUB_TOKEN }}
          time-range: 24h
          severity-focus: errors
          review-mode: review
```

If your Loki instance is unauthenticated (common for self-hosted single-tenant setups), omit `loki-api-key` and `loki-org-id`.

## What SWEny Does

1. Queries Loki using LogQL — stream selector `{job=~".*<service-filter>.*"}` with a line filter for `error` — over the configured time range.
2. Aggregates error counts per `job` label to identify the noisiest service.
3. Investigates the top error — pulls surrounding log lines from Loki for context.
4. Checks GitHub Issues for existing coverage (novelty mode).
5. If novel: opens a GitHub Issue with a description, log excerpts, and fix suggestions.
6. If `review-mode: auto` and the fix is low-risk: opens a pull request.

## Tips

- **`job` label**: SWEny's Loki queries use the `job` label to match services. Ensure your Promtail/Alloy/Vector configuration sets a meaningful `job` value (e.g., `job="my-node-service"`). If you use `service_name` instead, set `service-filter: *` and SWEny will scan all streams.
- **`service-filter`** in `.sweny.yml` is interpolated into a LogQL regex: `{job=~".*<filter>.*"}`. Set it to your service's `job` label value.
- **Structured logs**: Node.js apps using `pino` or `winston` (JSON output) work best. Loki parses the JSON and exposes fields like `level` as labels, giving SWEny richer filtering options.
- **Grafana Cloud free tier**: the free tier supports log queries but has a retention limit (30 days). `time-range: 24h` keeps you well within it.
- **Self-hosted single-tenant Loki**: omit `LOKI_API_KEY` and `LOKI_ORG_ID` entirely — unauthenticated requests work by default.
- **TLS / self-signed certs**: if your Loki instance uses a private CA, you may need to set `NODE_EXTRA_CA_CERTS` in the workflow environment pointing to your CA bundle.
