<p align="center">
  <img src="https://sweny.ai/logo.png" alt="SWEny" width="120" />
</p>

<h1 align="center">SWEny</h1>

<p align="center">
  <strong>Build AI-powered engineering workflows that learn from any source, take any action, and report through any channel.</strong>
</p>

<p align="center">
  <a href="https://github.com/swenyai/sweny/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/swenyai/sweny/ci.yml?style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@sweny-ai/providers"><img alt="npm" src="https://img.shields.io/npm/v/@sweny-ai/providers?style=flat-square&color=orange" /></a>
  <a href="https://github.com/swenyai/sweny/releases"><img alt="Release" src="https://img.shields.io/github/v/release/swenyai/sweny?style=flat-square&color=orange" /></a>
  <a href="https://github.com/swenyai/sweny/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/swenyai/sweny?style=flat-square" /></a>
  <a href="https://sweny.ai"><img alt="Website" src="https://img.shields.io/badge/sweny.ai-website-blue?style=flat-square" /></a>
</p>

---

This monorepo contains the SWEny platform:

| Package | Description |
|---------|-------------|
| **[@sweny-ai/engine](packages/engine)** | Workflow engine — Learn, Act, Report |
| **[@sweny-ai/cli](packages/cli)** | CLI — run triage from your terminal |
| **[SWEny Triage](#sweny-triage)** | GitHub Action — autonomous SRE triage |
| **[@sweny-ai/providers](packages/providers)** | 30+ provider implementations |
| **[@sweny-ai/agent](packages/agent)** | AI assistant — Slack bot + CLI |
| **[@sweny-ai/web](packages/web)** | sweny.ai website |

---

## How It Works

SWEny workflows follow three phases:

- **Learn** -- Connect any input source (observability logs, issue trackers, APIs) to gather context about your system.
- **Act** -- Take any action (create tickets, open PRs, dispatch workflows) based on AI-driven analysis.
- **Report** -- Notify through any channel (Slack, email, GitHub, Discord, Teams, webhooks) with full investigation details.

```
┌─────────────────────────────────────────────┐
│  Entry Points                               │
│  GitHub Action · Slack Bot · CLI · Cloud     │
├─────────────────────────────────────────────┤
│  @sweny-ai/engine                              │
│  Workflow Runner · Recipes · Step Context    │
├─────────────────────────────────────────────┤
│  @sweny-ai/providers                           │
│  Observability · Issue Tracking · Source     │
│  Control · Notification · Coding Agent      │
└─────────────────────────────────────────────┘
```

Entry points (GitHub Action, Slack Bot, CLI) feed into the **@sweny-ai/engine**, which orchestrates recipes -- pre-built workflows composed of Learn, Act, and Report steps. Each step delegates to a pluggable provider from **@sweny-ai/providers**, so you can swap Datadog for CloudWatch or Linear for Jira without changing your workflow.

---

## SWEny Triage

**SWEny Triage is the first recipe built on the engine** -- autonomous SRE triage that monitors your observability logs, investigates issues with Claude AI, creates tickets, and opens fix PRs, all without human intervention.

Instead of waking up to a wall of alerts, SWEny Triage analyzes your logs overnight, identifies the highest-impact issue, creates a ticket with full root cause analysis, implements a fix, and opens a PR ready for review by morning.

### Quick Start

**Step 1: Try it out (dry run, 3 secrets)**

Create `.github/workflows/sweny-triage.yml`:

```yaml
name: SWEny Triage
on:
  workflow_dispatch:  # Manual trigger to start

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

      - uses: swenyai/sweny@v0.2
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          dry-run: true
```

That's it — 3 secrets and you'll see a full investigation report in the GitHub Actions summary. No PRs, no tickets, just analysis.

> **Why `claude-oauth-token`?** This uses your Claude Max subscription — predictable monthly cost, no per-token billing surprises. If you prefer pay-per-use, swap it for `anthropic-api-key` with an [Anthropic API key](https://console.anthropic.com/).

**Step 2: Turn it on**

Once you're happy with the investigation quality, remove `dry-run`, add write permissions, and schedule it:

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 6 * * 1,4'  # Mon & Thu at 6 AM UTC
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/sweny@v0.2
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
```

SWEny creates GitHub Issues by default — zero additional config. Want Linear or Jira instead? See [Issue Tracker](#issue-tracker) below.

### How It Works

```
                    ┌─────────────────────┐
                    │   Schedule / Manual  │
                    │      Trigger         │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Learn               │
                    │                      │
                    │  • Query logs        │
                    │  • Analyze errors    │
                    │  • Check tracker for │
                    │    known issues      │
                    │  • Rank by impact    │
                    └──────────┬──────────┘
                               │
                  ┌────────────┼────────────┐
                  │            │            │
            ┌─────▼────┐ ┌────▼─────┐ ┌────▼─────┐
            │  skip     │ │ +1       │ │implement │
            │           │ │ existing │ │          │
            │  No novel │ │          │ │  Novel   │
            │  issues   │ │ Add      │ │  issue   │
            └───────────┘ │ occurrence│ └────┬─────┘
                          └──────────┘      │
                                 ┌──────────▼──────────┐
                                 │  Act                 │
                                 │                      │
                                 │  • Create/find issue │
                                 │  • Create branch     │
                                 │  • Claude writes fix │
                                 │  • Open PR           │
                                 │  • Link to tracker   │
                                 └──────────┬───────────┘
                                            │
                                 ┌──────────▼──────────┐
                                 │  Report              │
                                 │                      │
                                 │  • GitHub Summary    │
                                 │  • Investigation log │
                                 │  • Issue report      │
                                 └──────────────────────┘
```

**Novelty gate** — SWEny won't create duplicate tickets. It checks Linear and GitHub for existing issues before acting, and adds "+1 occurrence" comments to known issues instead.

**Cross-repo dispatch** — If the bug belongs to a different repository (determined via your service map), SWEny automatically dispatches the fix to the correct repo.

### Inputs

#### Authentication

| Input | Description | Required |
|-------|-------------|----------|
| `claude-oauth-token` | Claude Code OAuth token (Max subscription) — predictable cost | Recommended |
| `anthropic-api-key` | Anthropic API key (pay-per-use) | Alternative |

> Use `claude-oauth-token` with a Claude Max subscription for predictable monthly costs. Set it as a repository secret named `CLAUDE_CODE_OAUTH_TOKEN`. The `anthropic-api-key` option is available if you prefer direct API billing.

#### Observability Provider

| Input | Description | Default |
|-------|-------------|---------|
| `observability-provider` | Provider to use | `datadog` |
| **Datadog** | | |
| `dd-api-key` | Datadog API key | — |
| `dd-app-key` | Datadog Application key | — |
| `dd-site` | Datadog site | `datadoghq.com` |
| **Sentry** | | |
| `sentry-auth-token` | Sentry auth token | — |
| `sentry-organization` | Sentry organization slug | — |
| `sentry-project` | Sentry project slug | — |
| **CloudWatch** | | |
| `cloudwatch-region` | AWS region | — |
| `cloudwatch-log-group-prefix` | Log group prefix to scan | — |
| **Splunk** | | |
| `splunk-url` | Splunk instance URL | — |
| `splunk-token` | Splunk HEC token | — |
| `splunk-index` | Splunk index to query | — |
| **Elasticsearch** | | |
| `elastic-url` | Elasticsearch URL | — |
| `elastic-api-key` | Elasticsearch API key | — |
| `elastic-index` | Elasticsearch index pattern | — |
| **New Relic** | | |
| `newrelic-api-key` | New Relic API key | — |
| `newrelic-account-id` | New Relic account ID | — |
| `newrelic-region` | New Relic region (`us` or `eu`) | `us` |
| **Grafana Loki** | | |
| `loki-url` | Loki endpoint URL | — |
| `loki-api-key` | Loki API key | — |
| `loki-org-id` | Loki tenant/org ID | — |

#### Issue Tracker

| Input | Description | Default |
|-------|-------------|---------|
| `issue-tracker-provider` | Provider to use | `github-issues` |
| **Linear** | | |
| `linear-api-key` | Linear API key | — |
| `linear-team-id` | Linear team UUID | — |
| `linear-bug-label-id` | Label UUID for bugs | — |
| `linear-triage-label-id` | Label UUID for agent-triage | — |
| `linear-state-backlog` | State UUID for Backlog | — |
| `linear-state-in-progress` | State UUID for In Progress | — |
| `linear-state-peer-review` | State UUID for Peer Review | — |
| **Jira** | | |
| `jira-base-url` | Jira instance URL | — |
| `jira-email` | Jira account email | — |
| `jira-api-token` | Jira API token | — |
| **GitHub Issues** | | |
| Uses existing `github-token` | | |

#### Source Control

| Input | Description | Default |
|-------|-------------|---------|
| `source-control-provider` | Provider to use | `github` |
| `gitlab-token` | GitLab personal access token | — |
| `gitlab-project-id` | GitLab project ID | — |
| `gitlab-base-url` | GitLab base URL | `https://gitlab.com` |

#### Investigation

| Input | Description | Default |
|-------|-------------|---------|
| `time-range` | Time window to analyze (`1h`, `6h`, `24h`, `7d`) | `24h` |
| `severity-focus` | What to look for (`errors`, `warnings`, `all`) | `errors` |
| `service-filter` | Service pattern (`my-svc`, `api-*`, `*`) | `*` |
| `investigation-depth` | How deep Claude goes (`quick`, `standard`, `thorough`) | `standard` |
| `max-investigate-turns` | Max Claude turns for investigation | `50` |
| `max-implement-turns` | Max Claude turns for implementation | `30` |

#### Behavior

| Input | Description | Default |
|-------|-------------|---------|
| `dry-run` | Analyze only, don't create PRs | `false` |
| `novelty-mode` | Only report issues not already tracked | `true` |
| `linear-issue` | Work on a specific Linear issue (e.g., `ENG-123`) | — |
| `additional-instructions` | Extra guidance for Claude | — |
| `service-map-path` | Path to service ownership map | `.github/service-map.yml` |
| `github-token` | GitHub token for PRs | `${{ github.token }}` |
| `bot-token` | Token with cross-repo permissions | — |

### Outputs

| Output | Description |
|--------|-------------|
| `issues-found` | Whether issues were found (`true`/`false`) |
| `recommendation` | What SWEny decided (`implement`, `+1 existing ENG-123`, `skip`) |
| `issue-identifier` | Linear issue created/found (e.g., `ENG-456`) |
| `issue-url` | Linear issue URL |
| `pr-url` | Pull request URL (if created) |
| `pr-number` | Pull request number (if created) |

### Permissions

```yaml
permissions:
  contents: write       # Create branches and push commits
  pull-requests: write  # Open pull requests
```

If using cross-repo dispatch, pass a `bot-token` with `repo` and `actions` scopes for the target repositories.

### Examples

#### Deep investigation of last 7 days

```yaml
- uses: swenyai/sweny@v0.2
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
    time-range: '7d'
    investigation-depth: 'thorough'
```

#### Filter to a specific service

```yaml
- uses: swenyai/sweny@v0.2
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
    service-filter: 'billing-*'
    severity-focus: 'errors'
    time-range: '4h'
```

#### Use Linear for issue tracking

```yaml
- uses: swenyai/sweny@v0.2
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
    issue-tracker-provider: 'linear'
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
```

#### Work on a specific Linear issue

```yaml
- uses: swenyai/sweny@v0.2
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    issue-tracker-provider: 'linear'
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-issue: 'ENG-123'
    additional-instructions: 'Focus on the webhook handler timeout'
```

### Service Map

To enable cross-repo dispatch, create `.github/service-map.yml` in your repository:

```yaml
services:
  api-gateway:
    repo: "your-org/api-gateway"
    owns:
      - api-gateway
      - api-gateway-staging
  billing-service:
    repo: "your-org/billing"
    owns:
      - billing-svc
      - billing-svc-staging
```

When SWEny finds an error in `billing-svc`, it matches it to `your-org/billing` and dispatches the fix workflow there automatically.

### Provider Architecture

The engine is provider-agnostic. Every integration is a pluggable provider that maps to a workflow phase:

| Role | Providers |
|------|-----------|
| **Learn** | Datadog, Sentry, CloudWatch, Splunk, Elasticsearch, New Relic, Grafana Loki |
| **Act** | Linear, GitHub Issues, Jira (issue tracking) -- GitHub, GitLab (source control) -- PagerDuty, OpsGenie (incident) |
| **Report** | GitHub Summary, Slack, Teams, Discord, Email (SendGrid), Generic Webhook |
| **Infrastructure** | Filesystem / S3 / K8s CSI (storage) -- Env Vars / AWS Secrets Manager (credentials) -- API Key / No-Auth (auth) |
| **AI** | Claude Code, OpenAI Codex, Google Gemini CLI (coding agent) |

Implementing a custom provider means implementing a TypeScript interface -- see [`packages/providers/`](packages/providers/) for the full library and [`@sweny-ai/providers` on npm](https://www.npmjs.com/package/@sweny-ai/providers).

---

## @sweny-ai/cli

Run SWEny triage from your terminal — no CI pipeline required.

### Install

```bash
npm install -g @sweny-ai/cli
```

### Quick start

**1. Create a config file:**

```bash
sweny init
```

This creates `.sweny.yml` — edit it to set your providers:

```yaml
# .sweny.yml
observability-provider: datadog
time-range: 4h
```

**2. Add secrets to `.env`:**

```bash
# .env (gitignored)
CLAUDE_CODE_OAUTH_TOKEN=your-token
DD_API_KEY=your-api-key
DD_APP_KEY=your-app-key
GITHUB_TOKEN=ghp_...
```

**3. Run:**

```bash
sweny triage --dry-run
```

That's it. The CLI auto-loads `.env` and reads settings from `.sweny.yml`. Flags override the config file — use them for one-off changes:

```bash
sweny triage --dry-run --time-range 1h --service-filter 'billing-*'
```

### Config file

`.sweny.yml` uses flat kebab-case keys that match CLI flags 1:1:

```yaml
# .sweny.yml — commit this file. Secrets go in .env.
observability-provider: file
log-file: ./logs/errors.json
issue-tracker-provider: linear
linear-team-id: your-team-uuid
cache-dir: .sweny/cache
```

**Priority:** CLI flag > environment variable > `.sweny.yml` > default

### Step caching

Successful step results are cached to disk. If the workflow crashes or is cancelled after an expensive step (e.g., `investigate` takes 3+ minutes), re-running replays cached steps instantly:

```
First run:
  ✓ [1/9] verify-access          0s
  ✓ [2/9] build-context          1s
  ✓ [3/9] investigate         3m 6s   → cached
  ✗ [4/9] novelty-gate           1s   → crash

Re-run:
  ↻ [1/9] verify-access       cached
  ↻ [2/9] build-context       cached
  ↻ [3/9] investigate         cached  → replayed
  ✓ [4/9] novelty-gate           1s   → runs fresh
```

Cache flags:

| Flag | Description | Default |
|------|-------------|---------|
| `--cache-dir` | Cache directory | `.sweny/cache` |
| `--cache-ttl` | TTL in seconds (0 = infinite) | `86400` (24h) |
| `--no-cache` | Disable caching | — |

See the [CLI documentation](https://sweny.ai/cli/) for the full inputs reference.

---

## @sweny-ai/agent

AI assistant framework powered by [Claude Code SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) — deploy as a Slack bot or CLI with a plugin architecture for custom tools.

See [`packages/agent/`](packages/agent/) for documentation.

---

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Type-check all packages
npm run typecheck

# Run all tests
npm test

# Run the CLI locally (auto-loads .env)
npx tsx packages/cli/src/main.ts triage --dry-run

# Run the agent locally
npm run cli:agent

# Build the action
cd packages/action
npm run package    # Produces dist/index.js via ncc
```

> **Note:** The root `dist/` directory is committed intentionally — GitHub Actions require a compiled entry point (`dist/index.js` built via [ncc](https://github.com/vercel/ncc)). Do not remove it.

## License

[MIT](LICENSE)
