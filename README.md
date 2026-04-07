<p align="center">
  <img src="assets/logo-lockup-dark.svg" alt="SWEny" width="280" />
</p>

<p align="center">
  <strong>Turn natural language into reliable AI workflows.</strong>
</p>

<p align="center">
  <a href="https://github.com/swenyai/sweny/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/swenyai/sweny/ci.yml?style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@sweny-ai/core"><img alt="npm" src="https://img.shields.io/npm/v/@sweny-ai/core?style=flat-square&color=orange" /></a>
  <a href="https://github.com/swenyai/sweny/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/swenyai/sweny?style=flat-square" /></a>
  <a href="https://docs.sweny.ai"><img alt="Docs" src="https://img.shields.io/badge/docs-docs.sweny.ai-blue?style=flat-square" /></a>
  <a href="https://marketplace.sweny.ai"><img alt="Workflow Marketplace" src="https://img.shields.io/badge/Workflows-marketplace.sweny.ai-blueviolet?style=flat-square" /></a>
  <a href="https://github.com/marketplace/actions/sweny-ai"><img alt="GitHub Marketplace" src="https://img.shields.io/badge/GitHub%20Marketplace-SWEny%20AI-orange?style=flat-square&logo=github" /></a>
</p>

---

Describe what you want done. SWEny builds a DAG, wires up the right tools, and runs it. Every node, every tool call, every routing decision is tracked.

```bash
$ sweny workflow create "audit our GitHub repo for security issues, \
    scan dependencies for vulnerabilities, and create Linear tickets \
    for anything critical"

  GitHub Security Audit

  ○ Scan Recent Commits for Exposed Secrets
  │
  ├──► ○ Review Open PRs for Security Changes
  └──► ○ Scan Dependencies for Vulnerabilities
       │
  ○ Compile Security Posture Report
  │
  ○ Create Linear Tickets for Critical Findings

  Save to .sweny/workflows/github_security_audit.yml? [Y/n/refine]
```

One sentence in, a full workflow out — with structured output schemas, conditional routing, and the right skills at each node. Refine with natural language, run it, or publish to GitHub Actions.

## Get started

```bash
npm install -g @sweny-ai/core
sweny workflow create "your task description here"
sweny workflow run .sweny/workflows/your-workflow.yml
```

Or browse ready-to-run workflows at **[marketplace.sweny.ai](https://marketplace.sweny.ai)** — copy one into `.sweny/workflows/`, customize, run.

## How you use it

| Approach | What it does |
|----------|--------------|
| **[CLI](https://docs.sweny.ai/cli/)** | Build and run workflows from your terminal. Describe a task, get a DAG, run it. |
| **[GitHub Action](https://docs.sweny.ai/action/)** | Run any SWEny workflow on CI — triage, implement, or your own custom YAML. See the [recipes](#recipes) below. |
| **[Studio](https://docs.sweny.ai/studio/)** | Visual DAG editor and live execution monitor. Watch workflows run in real time. |
| **[Claude Code Plugin](https://docs.sweny.ai/advanced/mcp-plugin/)** | `/plugin install https://github.com/swenyai/sweny` — slash commands, MCP tools, hooks, isolated agent. |
| **[MCP Server](https://docs.sweny.ai/advanced/mcp-plugin/)** | Use SWEny from Claude Code or Claude Desktop. Claude delegates complex tasks to SWEny's DAG executor. |
| **[Marketplace](https://marketplace.sweny.ai)** | Browse community workflows. Copy one into your repo, customize the steps, run it. |

## Recipes

The GitHub Action ships as a single generic engine — `swenyai/sweny@v4` — that runs any SWEny workflow. The recipes below show common wiring patterns; pick one or assemble your own. More are listed at [marketplace.sweny.ai](https://marketplace.sweny.ai).

### SRE triage

The original built-in workflow. Watches your observability provider for new issues, investigates them, files tickets, and (optionally) opens fix PRs.

```yaml
name: Triage
on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny@v4
        with:
          workflow: triage
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          observability-provider: datadog
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}
          issue-tracker-provider: linear
          linear-api-key: ${{ secrets.LINEAR_API_KEY }}
```

### Implement from an issue

Reads a Linear or GitHub issue, plans a fix, writes the code, opens a PR.

```yaml
name: Implement
on:
  issues:
    types: [labeled]

jobs:
  implement:
    if: github.event.label.name == 'sweny:implement'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny@v4
        with:
          workflow: implement
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          issue-tracker-provider: github
```

### Agentic E2E browser testing

Agent-driven end-to-end tests against a deployed app — no Playwright scripts, the agent figures out the DOM. Generate the workflow with `sweny e2e init`, then run it on CI with the [`actions/e2e`](actions/e2e) preset, which adds [`agent-browser`](https://www.npmjs.com/package/agent-browser) installation, a `BASE_URL` convention, and automatic screenshot artifact upload.

```yaml
name: E2E UAT
on:
  workflow_run:
    workflows: ["Deploy to Staging"]
    types: [completed]

jobs:
  e2e:
    runs-on: macos-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny/actions/e2e@v4
        with:
          workflow: .sweny/e2e/uat.yml
          base-url: https://staging.example.com
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        env:
          # Anything your test workflow needs for provisioning, auth, cleanup, etc.
          AUTH0_M2M_CLIENT_ID: ${{ secrets.AUTH0_M2M_CLIENT_ID }}
          AUTH0_M2M_CLIENT_SECRET: ${{ secrets.AUTH0_M2M_CLIENT_SECRET }}
```

### Run any custom workflow

For workflows that don't need extra browser tooling — content pipelines, audits, release notes, competitive analysis, anything you generate with `sweny workflow create`. Use the [`actions/run`](actions/run) preset for the minimal install footprint.

```yaml
name: Weekly competitive scan
on:
  schedule:
    - cron: "0 9 * * 1" # Mondays at 09:00 UTC
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny/actions/run@v4
        with:
          workflow: .sweny/workflows/competitive-scan.yml
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        env:
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
```

> You can also pass a custom workflow path to the root `swenyai/sweny@v4` action via `workflow: .sweny/workflows/my.yml` — the engine accepts arbitrary workflow YAML. The `actions/run` preset is just a thinner wrapper without the triage-flavored input surface.

### Available presets

| Preset | Use it for | What it adds |
|---|---|---|
| [`swenyai/sweny@v4`](.) | Triage, implement, or any custom workflow | Built-in workflows + provider context (Datadog, Sentry, Linear, GitHub, …) auto-wired from inputs |
| [`swenyai/sweny/actions/run@v4`](actions/run) | Generic workflow execution | Minimal install footprint, env passthrough only |
| [`swenyai/sweny/actions/e2e@v4`](actions/e2e) | Agentic E2E tests | `agent-browser` install, `BASE_URL` input, screenshot artifact upload |

## Built-in skills

Skills connect Claude to external services. Set the credential, the skill is ready.

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

SWEny splits tasks into nodes in a DAG. Each node gets a focused instruction, scoped tools, and structured output — so instead of one giant prompt, you get a reliable pipeline.

- **Build** — `sweny workflow create` turns a natural language description into a workflow YAML with nodes, edges, skills, and output schemas.
- **Refine** — `sweny workflow edit` modifies workflows with natural language. Add quality gates, loop-back conditions, notification steps — no YAML editing.
- **Run** — The DAG executor walks nodes in order, resolves conditional edges, and tracks every tool call.
- **Deploy** — Run from the CLI or schedule via GitHub Actions. Browse [marketplace.sweny.ai](https://marketplace.sweny.ai) for ready-to-run workflows.

## Real-world examples

All generated from a single sentence with `sweny workflow create`:

- **Content pipeline** — Generate blog posts, run them through an LLM quality judge, publish passing content to the CMS. Used for [kidmath.ai](https://kidmath.ai).
- **Security audit** — Scan commits for secrets, review PRs for security issues, check dependencies, compile a report, file Linear tickets.
- **Competitive analysis** — Research competitors, gather pricing and features, synthesize a comparison matrix, produce an executive brief.
- **Product launch** — Research recent launches, draft copy with a quality gate, create a Linear checklist, compile a launch brief.

Not just code tasks — SWEny works for anything you can describe as steps with clear inputs and outputs.

## Packages

| Package | Directory | Published | Description |
|---------|-----------|-----------|-------------|
| `@sweny-ai/core` | `packages/core` | npm | Skill library, DAG executor, CLI, workflows |
| `@sweny-ai/studio` | `packages/studio` | npm | Visual DAG editor and execution monitor |
| `@sweny-ai/mcp` | `packages/mcp` | npm | MCP server for Claude Code / Desktop |
| — | `packages/plugin` | — | Claude Code plugin: slash commands, MCP tools, agent, hooks |
| `@sweny-ai/action` | `packages/action` | private | GitHub Action wrapper |
| `@sweny-ai/web` | `packages/web` | private | docs.sweny.ai website |

## Workflow Marketplace

**[marketplace.sweny.ai](https://marketplace.sweny.ai)** — a community catalog of ready-to-run SWEny workflows. Browse by category, copy the YAML into `.sweny/workflows/`, customize the steps, and run.

Anything built with `sweny workflow create` can be shared. The CLI and Action stay free and open source.

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
