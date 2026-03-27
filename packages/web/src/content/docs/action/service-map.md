---
title: Service Map
description: Scope triage to specific services with ownership metadata.
---

A service map tells SWEny which parts of your codebase belong to which services and teams. When SWEny investigates an error, it uses the map to focus on the right code, assign the right owners, and filter alerts to specific services.

Install the Action across multiple repos, each with its own service map, and SWEny handles an entire team's worth of triage -- every service scoped to the code it owns.

## Creating a service map

Create `.github/service-map.yml` in your repository:

```yaml
services:
  api:
    paths:
      - "src/api/**"
      - "src/routes/**"
    owners:
      - "@backend-team"
    observability:
      sentry-project: api-service
      datadog-service: api-prod

  worker:
    paths:
      - "src/workers/**"
      - "src/jobs/**"
    owners:
      - "@infra-team"
    observability:
      datadog-service: worker-prod

  billing:
    paths:
      - "src/billing/**"
      - "src/payments/**"
    owners:
      - "@payments-team"
    observability:
      sentry-project: billing-service

  auth:
    paths:
      - "src/auth/**"
      - "src/middleware/auth*"
    owners:
      - "@security-team"
    observability:
      sentry-project: auth-service
```

### Fields

| Field | Description |
|-------|-------------|
| `paths` | Glob patterns for the files this service owns. Used to scope code investigation |
| `owners` | GitHub teams or individuals responsible for the service. Included in issue metadata |
| `observability` | Maps provider-specific identifiers (Sentry project, Datadog service name) to this service |

## How it works

1. SWEny queries your observability provider for errors in the configured `time-range`
2. It matches each error to a service using the `observability` mapping (e.g., a Sentry error from project `api-service` maps to the `api` service)
3. Investigation is scoped to the file paths listed for that service
4. Created issues include the service name and owners in their metadata

The result is faster, more focused triage. Instead of searching the entire codebase for a root cause, SWEny narrows its investigation to the relevant directories.

## Filtering with `service-filter`

The `service-filter` input works with the service map to limit which services SWEny investigates:

```yaml
      - uses: swenyai/sweny@v4
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          service-filter: 'billing'
```

Filter patterns:

| Pattern | Matches |
|---------|---------|
| `*` | All services (default) |
| `api` | Only the `api` service |
| `billing-*` | Services starting with `billing-` |
| `api,worker` | Multiple specific services |

When `service-filter` is set, SWEny only queries logs for matching services and only investigates their code paths. This is useful for running targeted triage on a specific area after an incident.

## Multi-repo setup

The most powerful pattern: install SWEny in every repository, each with its own service map. Each repo's triage is scoped to the services that live there.

### Repo: `your-org/api-gateway`

```yaml
# .github/service-map.yml
services:
  api-gateway:
    paths: ["src/**"]
    owners: ["@backend-team"]
    observability:
      datadog-service: api-gateway-prod
```

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
```

### Repo: `your-org/billing`

```yaml
# .github/service-map.yml
services:
  billing-api:
    paths: ["src/api/**"]
    owners: ["@payments-team"]
    observability:
      sentry-project: billing-api
  billing-worker:
    paths: ["src/workers/**"]
    owners: ["@payments-team"]
    observability:
      sentry-project: billing-worker
```

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
          observability-provider: sentry
          sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: your-org
```

Each repo triages its own services independently. The API gateway repo investigates Datadog errors for `api-gateway-prod`. The billing repo investigates Sentry errors for `billing-api` and `billing-worker`. PRs are opened in the repo that owns the code.

## Cross-repo dispatch

When SWEny finds an error in a service that lives in a different repository, it can dispatch the fix workflow to the correct repo. This requires a `bot-token` with `repo` and `actions` scopes for all target repositories:

```yaml
      - uses: swenyai/sweny@v4
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          bot-token: ${{ secrets.BOT_TOKEN }}
```

The bot token must have access to create `repository_dispatch` events on the target repos. A [GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps) with repository dispatch permissions is recommended over personal access tokens.

## Custom service map path

By default, SWEny looks for the service map at `.github/service-map.yml`. To use a different path:

```yaml
      - uses: swenyai/sweny@v4
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          service-map-path: config/services.yml
```

## Monorepo pattern

For monorepos with many services, the service map is especially valuable. Define every service with its paths and SWEny investigates only the relevant directories:

```yaml
services:
  web-app:
    paths:
      - "apps/web/**"
    owners: ["@frontend-team"]
    observability:
      vercel-project-id: prj_abc123

  api-server:
    paths:
      - "apps/api/**"
      - "packages/shared/**"
    owners: ["@backend-team"]
    observability:
      datadog-service: api-server

  background-jobs:
    paths:
      - "apps/jobs/**"
      - "packages/shared/**"
    owners: ["@backend-team"]
    observability:
      datadog-service: bg-jobs

  mobile-api:
    paths:
      - "apps/mobile-api/**"
    owners: ["@mobile-team"]
    observability:
      sentry-project: mobile-api
```

:::note[Shared packages]
Multiple services can reference the same paths (like `packages/shared/**`). When an error traces to shared code, SWEny identifies the calling service and investigates both the shared code and the service-specific code.
:::
