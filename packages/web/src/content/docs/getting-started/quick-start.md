---
title: Quick Start
description: Install SWEny and choose how to run it — Claude Code plugin, CLI, GitHub Action, Studio, or Marketplace.
---

SWEny is one tool with multiple surfaces. Install it once, then pick the way that fits your workflow.

## Install

```bash
npm install -g @sweny-ai/core
```

You can also run it directly with `npx @sweny-ai/core`.

## Add your API key

SWEny uses [Claude](https://claude.ai/) as its AI engine. You'll need an Anthropic API key, OAuth token, or authenticated Claude Code instance.

```bash
# .env (gitignored)
ANTHROPIC_API_KEY=sk-ant-...
```

Or use a Claude subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) for flat-rate billing. The CLI auto-loads `.env` at startup.

## Choose your surface

### Claude Code Plugin — use SWEny inside Claude Code

If you use [Claude Code](https://code.claude.com), install the plugin and get 11 slash commands, MCP tools, and a startup hook:

```
/plugin install https://github.com/swenyai/sweny
```

Then use `/sweny:triage` to investigate production alerts, `/sweny:implement ENG-123` to fix an issue, `/sweny:e2e-run` to run browser tests, or `/sweny:workflow-create` to build a custom workflow — all without leaving your conversation.

**[Full plugin guide](/advanced/mcp-plugin/)** — all skills, MCP tools, hooks, and agent details.

### CLI — build and run workflows from your terminal

The fastest way to get things done. Describe a task, get a workflow, run it.

```bash
# Create a workflow from a description
sweny workflow create "scan the codebase for security anti-patterns \
  and create tickets for critical findings"

# Refine it
sweny workflow edit .sweny/workflows/security_scan.yml \
  "add a quality gate that rejects vague findings"

# Run it
sweny workflow run .sweny/workflows/security_scan.yml
```

You can also run the built-in workflows directly:

```bash
sweny triage --dry-run          # investigate production errors
sweny implement ENG-123         # fix a tracked issue and open a PR
```

Or generate AI-driven browser tests for any web app:

```bash
sweny e2e init                  # wizard generates test workflows
sweny e2e run                   # AI agent drives a real browser
```

**[Full CLI guide](/cli/)** — commands, configuration, and real-world examples. **[E2E testing guide](/cli/e2e/)** — browser test generation and execution.

### GitHub Action — deploy workflows to CI

Put workflows on a schedule. SWEny monitors your observability platform, triages errors, and opens fix PRs — automatically.

```yaml
# .github/workflows/sweny-triage.yml
- uses: swenyai/sweny@v4
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    observability-provider: sentry
    sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
    sentry-org: my-org
    sentry-project: my-project
```

Three secrets. Push the file, trigger it from the Actions tab, and check the summary.

**[Full Action guide](/action/)** — setup, inputs, scheduling, and service maps.

### Studio — visualize and monitor workflows

A visual DAG editor and live execution monitor built on React Flow. Design workflows by dragging nodes, or watch running workflows execute node-by-node in real time.

```bash
# Stream a CLI run to Studio
sweny triage --stream
```

**[Full Studio guide](/studio/)** — editor, embedding, and live mode.

### Marketplace — start from a community workflow

Don't want to write a workflow from scratch? Browse **[marketplace.sweny.ai](https://marketplace.sweny.ai)** for ready-to-run SWEny workflows. Pick one, copy the YAML into `.sweny/workflows/`, customize the steps, and run.

## What's next?

- **[Core Concepts](/getting-started/concepts/)** — understand workflows, nodes, edges, and skills
- **[CLI Examples](/cli/examples/)** — real-world workflows from one-liners to complex pipelines
- **[End-to-End Walkthrough](/getting-started/walkthrough/)** — follow a real triage run from error spike to fix PR
