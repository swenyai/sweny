<h1 align="center">SWEny</h1>

<p align="center">
  <strong>Workflow orchestration for AI-powered engineering.</strong>
</p>

<p align="center">
  <a href="https://github.com/swenyai/sweny/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/swenyai/sweny/ci.yml?style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@sweny-ai/core"><img alt="npm" src="https://img.shields.io/npm/v/@sweny-ai/core?style=flat-square&color=orange" /></a>
  <a href="https://github.com/swenyai/sweny/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/swenyai/sweny?style=flat-square" /></a>
  <a href="https://docs.sweny.ai"><img alt="Docs" src="https://img.shields.io/badge/docs-docs.sweny.ai-blue?style=flat-square" /></a>
  <a href="https://github.com/marketplace/actions/sweny-ai"><img alt="Marketplace" src="https://img.shields.io/badge/GitHub%20Marketplace-SWEny%20AI-orange?style=flat-square&logo=github" /></a>
</p>

---

Define a workflow as a DAG. Claude executes each node using the tools you configure. Get reliable, observable results — every node, every tool call, every routing decision is tracked.

```yaml
# .github/workflows/sweny-triage.yml
name: SWEny Triage
on:
  schedule:
    - cron: '0 6 * * 1,4'
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
      - uses: swenyai/sweny@v4
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
```

Three secrets. SWEny monitors your logs, investigates the highest-impact issue, creates a ticket, implements a fix, and opens a PR.

## Three entry points

| Entry point | Use case |
|-------------|----------|
| **[GitHub Action](https://docs.sweny.ai/action/)** | Primary. Runs on schedule or dispatch in CI. |
| **[CLI](https://docs.sweny.ai/cli/)** | Local development. `sweny triage --dry-run` from your terminal. |
| **[Studio](https://docs.sweny.ai/studio/)** | Visual DAG editor and live execution monitor. |

## Built-in skills

Skills are groups of tools that connect Claude to external services. Each skill is configured through environment variables — set the credential and the skill is ready.

| Skill | Category | What Claude can do |
|-------|----------|--------------------|
| **github** | git | Search code, read files, create issues, open PRs |
| **linear** | tasks | Create, search, and update issues |
| **sentry** | observability | Query errors, issues, and stack traces |
| **datadog** | observability | Query logs, metrics, and monitors |
| **betterstack** | observability | Query incidents, monitors, and logs |
| **slack** | notification | Send messages via webhook or bot API |
| **notification** | notification | Discord, Teams, email, generic webhooks |

## How it works

SWEny workflows have two layers:

- **Orchestration** — A deterministic DAG executor walks nodes in order, resolves conditional edges, and tracks results.
- **Agency** — At each node, Claude runs as a full agent with access to the node's tools, the file system, terminal, and any configured MCP servers.

The executor uses headless [Claude Code](https://docs.anthropic.com/en/docs/claude-code) via `@anthropic-ai/claude-agent-sdk` as the LLM backend. MCP servers for GitHub, Linear, Sentry, Datadog, and others are [auto-injected](https://docs.sweny.ai/advanced/mcp-servers/) based on your provider configuration.

## Packages

| Package | Directory | Published | Description |
|---------|-----------|-----------|-------------|
| `@sweny-ai/core` | `packages/core` | npm | Skill library, DAG executor, CLI, workflows |
| `@sweny-ai/studio` | `packages/studio` | npm | Visual DAG editor and execution monitor |
| `@sweny-ai/action` | `packages/action` | private | GitHub Action wrapper |
| `@sweny-ai/web` | `packages/web` | private | docs.sweny.ai website |
| ~~`@sweny-ai/engine`~~ | `packages/engine` | deprecated | Replaced by `@sweny-ai/core` |
| ~~`@sweny-ai/providers`~~ | `packages/providers` | deprecated | Replaced by `@sweny-ai/core` skills |
| ~~`@sweny-ai/agent`~~ | `packages/agent` | deprecated | Migrating to `@sweny-ai/core` |

## Documentation

Full documentation at **[docs.sweny.ai](https://docs.sweny.ai)**.

- [Quick Start](https://docs.sweny.ai/getting-started/quick-start/) — Get running in 5 minutes
- [Workflows](https://docs.sweny.ai/workflows/) — Triage, Implement, and custom workflows
- [Skills](https://docs.sweny.ai/skills/) — Built-in skill reference
- [Architecture](https://docs.sweny.ai/advanced/architecture/) — Two-layer execution model

## Development

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run typecheck    # Type-check all packages
npm test             # Run all tests
```

> The root `dist/` directory is committed intentionally — GitHub Actions require a compiled entry point.

## License

[MIT](LICENSE)
