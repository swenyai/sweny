---
title: Quick Start
description: Install SWEny and choose how to run it: Claude Code plugin, CLI, GitHub Action, or Studio.
---

SWEny is one tool with multiple surfaces. Install it once, then pick the way that fits your workflow.

## Install

```bash
npm install -g @sweny-ai/core
```

Every command below uses the installed `sweny` binary. Try it with no credentials beyond your Claude login:

```bash
sweny new --template explain-repo --yes
sweny workflow run .sweny/workflows/explain-repo.yml
```

## Add your API key

SWEny runs nodes on Claude Code by default (Codex, pi and ACP agents are covered in [Agents and policies](/getting-started/agents-and-policies/)). For Claude Code you need an Anthropic API key, OAuth token, or an authenticated Claude Code instance.

```bash
# .env (gitignored)
ANTHROPIC_API_KEY=sk-ant-...
```

Or use a Claude subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) for flat-rate billing. The CLI auto-loads `.env` at startup.

## Choose your surface

### Claude Code Plugin — use SWEny inside Claude Code

If you use [Claude Code](https://code.claude.com), install the plugin and get 9 slash commands, MCP tools, and a startup hook:

```
/plugin marketplace add swenyai/sweny
/plugin install sweny@sweny-official
```

Then use `/sweny:triage` to investigate production alerts, `/sweny:implement ENG-123` to fix an issue, `/sweny:e2e-run` to run browser tests, or `/sweny:new` to create a workflow, all without leaving your conversation.

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
sweny new e2e                   # wizard generates test workflows
sweny workflow run              # AI agent drives a real browser
```

**[Full CLI guide](/cli/)** — commands, configuration, and real-world examples. **[E2E testing guide](/cli/e2e/)** — browser test generation and execution.

### GitHub Action — deploy workflows to CI

Put workflows on a schedule. SWEny monitors your observability platform, triages errors, and opens fix PRs — automatically.

```yaml
# .github/workflows/sweny-triage.yml
- uses: swenyai/triage@v1
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    observability-provider: sentry
    sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
    sentry-org: my-org
    sentry-project: my-project
```

Three secrets. Push the file, trigger it from the Actions tab, and check the summary. Use [`swenyai/sweny@v5`](https://github.com/swenyai/sweny) to run custom workflow YAMLs, or [`swenyai/e2e@v1`](https://github.com/swenyai/e2e) for browser tests.

**[Full Action guide](/action/)** — setup, inputs, scheduling, and service maps.

### Studio — visualize and monitor workflows

A visual DAG editor built on React Flow. Design workflows by dragging nodes. Live mode connects to a WebSocket or SSE event URL you provide and overlays node state as events arrive.

```bash
# From a repo checkout
npm run dev -w @sweny-ai/studio
```

**[Full Studio guide](/studio/)** — editor, embedding, and live mode.

## What's next?

- **[Core Concepts](/getting-started/concepts/)** — understand workflows, nodes, edges, and skills
- **[CLI Examples](/cli/examples/)** — real-world workflows from one-liners to complex pipelines
- **[End-to-End Walkthrough](/getting-started/walkthrough/)** — follow a real triage run from error spike to fix PR
