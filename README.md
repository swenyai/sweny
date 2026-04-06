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
  <a href="https://github.com/marketplace/actions/sweny-ai"><img alt="Marketplace" src="https://img.shields.io/badge/GitHub%20Marketplace-SWEny%20AI-orange?style=flat-square&logo=github" /></a>
  <a href="https://app.sweny.ai"><img alt="SWEny Cloud" src="https://img.shields.io/badge/SWEny%20Cloud-app.sweny.ai-blueviolet?style=flat-square" /></a>
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

## E2E browser testing

Generate AI-driven end-to-end tests for any web app — no test scripts to write:

```bash
sweny e2e init     # wizard asks about your flows → generates workflow YAML
sweny e2e run      # AI agent drives a real browser to test your app
```

The wizard supports registration, login, purchase, onboarding, upgrade, cancellation, and custom flows. Each generates a self-contained workflow with auto-generated test credentials and optional cleanup.

## How you use it

| Approach | What it does |
|----------|--------------|
| **[CLI](https://docs.sweny.ai/cli/)** | Build and run workflows from your terminal. Describe a task, get a DAG, run it. |
| **[E2E Testing](https://docs.sweny.ai/cli/e2e/)** | Generate and run AI-driven browser tests. No Playwright scripts — the agent figures out the DOM. |
| **[GitHub Action](https://docs.sweny.ai/action/)** | Publish workflows to CI. Runs on cron schedules or dispatch. |
| **[Studio](https://docs.sweny.ai/studio/)** | Visual DAG editor and live execution monitor. Watch workflows run in real time. |
| **[Claude Code Plugin](https://docs.sweny.ai/advanced/mcp-plugin/)** | `/plugin install https://github.com/swenyai/sweny` — slash commands, MCP tools, hooks, isolated agent. |
| **[MCP Server](https://docs.sweny.ai/advanced/mcp-plugin/)** | Use SWEny from Claude Code or Claude Desktop. Claude delegates complex tasks to SWEny's DAG executor. |
| **[SWEny Cloud](https://app.sweny.ai)** | Teams. Dashboard, shared credentials, scheduling, cross-repo analytics. |

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
- **Deploy** — Run from the CLI, schedule via GitHub Actions, or manage at scale with SWEny Cloud.

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

## SWEny Cloud

**[app.sweny.ai](https://app.sweny.ai)** — the managed platform built on top of the open-source core.

- **Dashboard** — view job history, logs, and results across all your repos in one place.
- **Team credentials** — securely store API keys and tokens so every repo can use them without per-repo secrets.
- **Schedules & webhooks** — set up recurring triage and auto-implement without managing GitHub cron.
- **Analytics** — track triage volume, fix rates, and mean-time-to-fix across your organization.

The Action and CLI are free and always will be. SWEny Cloud adds the operational layer for teams running SWEny at scale. [See pricing](https://app.sweny.ai/#/pricing).

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
