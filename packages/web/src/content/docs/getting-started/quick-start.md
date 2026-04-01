---
title: Quick Start
description: Install SWEny and choose how to run it — CLI, GitHub Action, Studio, or Cloud.
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

**[Full CLI guide](/cli/)** — commands, configuration, and real-world examples.

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

### SWEny Cloud — the team layer

Dashboard, shared credentials, scheduling, and cross-repo analytics for teams running SWEny at scale.

**[app.sweny.ai](https://app.sweny.ai)** — get started in minutes. [See pricing](https://app.sweny.ai/#/pricing).

## What's next?

- **[Core Concepts](/getting-started/concepts/)** — understand workflows, nodes, edges, and skills
- **[CLI Examples](/cli/examples/)** — real-world workflows from one-liners to complex pipelines
- **[End-to-End Walkthrough](/getting-started/walkthrough/)** — follow a real triage run from error spike to fix PR
