<p align="center">
  <img src="https://sweny.ai/logo.png" alt="SWEny" width="120" />
</p>

<h1 align="center">SWEny</h1>

<p align="center">
  <strong>Autonomous engineering tools powered by Claude AI</strong>
</p>

<p align="center">
  <a href="https://github.com/swenyai/sweny/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/swenyai/sweny/ci.yml?style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@sweny/providers"><img alt="npm" src="https://img.shields.io/npm/v/@sweny/providers?style=flat-square&color=orange" /></a>
  <a href="https://github.com/swenyai/sweny/releases"><img alt="Release" src="https://img.shields.io/github/v/release/swenyai/sweny?style=flat-square&color=orange" /></a>
  <a href="https://github.com/swenyai/sweny/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/swenyai/sweny?style=flat-square" /></a>
  <a href="https://sweny.ai"><img alt="Website" src="https://img.shields.io/badge/sweny.ai-website-blue?style=flat-square" /></a>
</p>

---

This monorepo contains the SWEny platform:

| Package | Description |
|---------|-------------|
| **[SWEny Triage](#sweny-triage)** | GitHub Action — autonomous SRE triage from observability logs |
| **[@sweny/providers](packages/providers)** | Shared provider interfaces and implementations |
| **[@sweny/agent](packages/agent)** | AI assistant framework — Slack bot + CLI with plugin architecture |
| **[@sweny/web](packages/web)** | Public website — sweny.ai |

---

## SWEny Triage

**Autonomous SRE triage that monitors your observability logs, investigates issues with Claude AI, creates tickets, and opens fix PRs — all without human intervention.**

Instead of waking up to a wall of alerts, SWEny Triage analyzes your Datadog logs overnight, identifies the highest-impact issue, creates a Linear ticket with full root cause analysis, implements a fix, and opens a PR ready for review by morning.

### Quick Start

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: '0 6 * * 1,4'  # Mon & Thu at 6 AM UTC
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/sweny@v0.1
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          linear-api-key: ${{ secrets.LINEAR_API_KEY }}
          linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
          linear-bug-label-id: ${{ vars.LINEAR_BUG_LABEL_ID }}
          linear-triage-label-id: ${{ vars.AGENT_TRIAGE_LABEL_ID }}
```

That's it. SWEny handles the rest.

### How It Works

```
                    ┌─────────────────────┐
                    │   Schedule / Manual  │
                    │      Trigger         │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Phase 1: Investigate│
                    │                     │
                    │  • Query Datadog    │
                    │  • Analyze errors   │
                    │  • Check Linear for │
                    │    known issues     │
                    │  • Rank by impact   │
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
                                 │  Phase 2: Implement  │
                                 │                      │
                                 │  • Create/find Linear│
                                 │    issue             │
                                 │  • Create branch     │
                                 │  • Claude writes fix │
                                 │  • Open PR           │
                                 │  • Link to Linear    │
                                 └──────────┬───────────┘
                                            │
                                 ┌──────────▼──────────┐
                                 │  Phase 3: Notify     │
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
| `claude-oauth-token` | Claude Code OAuth token (Max subscriptions) | Recommended |
| `anthropic-api-key` | Anthropic API key (pay-per-use) | Alternative |

> Most users should use `claude-oauth-token` — this is the token from Claude Max / Pro subscriptions. Set it as a repository secret named `CLAUDE_OAUTH_TOKEN`. The `anthropic-api-key` option is available for direct API billing.

#### Observability Provider

| Input | Description | Default |
|-------|-------------|---------|
| `observability-provider` | Provider to use | `datadog` |
| `dd-api-key` | Datadog API key | — |
| `dd-app-key` | Datadog Application key | — |
| `dd-site` | Datadog site | `datadoghq.com` |

#### Issue Tracker

| Input | Description | Default |
|-------|-------------|---------|
| `issue-tracker-provider` | Provider to use | `linear` |
| `linear-api-key` | Linear API key | — |
| `linear-team-id` | Linear team UUID | — |
| `linear-bug-label-id` | Label UUID for bugs | — |
| `linear-triage-label-id` | Label UUID for agent-triage | — |
| `linear-state-backlog` | State UUID for Backlog | — |
| `linear-state-in-progress` | State UUID for In Progress | — |
| `linear-state-peer-review` | State UUID for Peer Review | — |

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

#### Scheduled triage with dry-run first

```yaml
- uses: swenyai/sweny@v0.1
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
    dry-run: true
    time-range: '7d'
    investigation-depth: 'thorough'
```

#### Work on a specific Linear issue

```yaml
- uses: swenyai/sweny@v0.1
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-issue: 'ENG-123'
    additional-instructions: 'Focus on the webhook handler timeout'
```

#### Filter to a specific service

```yaml
- uses: swenyai/sweny@v0.1
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
    service-filter: 'billing-*'
    severity-focus: 'errors'
    time-range: '4h'
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

SWEny is built on a provider/plugin architecture. The core engine is provider-agnostic — it delegates to pluggable implementations:

| Provider Type | Ships With |
|---------------|-----------|
| **Observability** | Datadog, Sentry, CloudWatch, New Relic, Grafana Loki, Splunk, Elasticsearch |
| **Issue Tracker** | Linear, GitHub Issues, Jira |
| **Source Control** | GitHub, GitLab |
| **Notification** | GitHub Summary, Slack, Teams, Discord |
| **Incident** | PagerDuty, OpsGenie |
| **Messaging** | Slack, Microsoft Teams |
| **Auth** | No-Auth, API Key |
| **Access Control** | Allow-All Guard, Role-Based Guard |
| **Storage** | Filesystem, S3, Kubernetes CSI |
| **Credential Vault** | Env Vars, AWS Secrets Manager |
| **Coding Agent** | Claude Code |
| **Agent Tool** | Agent Tool |

Implementing a custom provider means implementing a TypeScript interface — see [`packages/providers/`](packages/providers/) for the full library and [`@sweny/providers` on npm](https://www.npmjs.com/package/@sweny/providers).

---

## @sweny/agent

AI assistant framework powered by [Claude Code SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) — deploy as a Slack bot or CLI with a plugin architecture for custom tools.

See [`packages/agent/`](packages/agent/) for documentation.

---

## Development

```bash
# Install dependencies
npm install

# Type-check all packages
npm run typecheck

# Build the action
cd packages/action
npm run package    # Produces dist/index.js via ncc

# Run the agent locally
npm run cli:agent
```

> **Note:** The root `dist/` directory is committed intentionally — GitHub Actions require a compiled entry point (`dist/index.js` built via [ncc](https://github.com/vercel/ncc)). Do not remove it.

## License

[MIT](LICENSE)
