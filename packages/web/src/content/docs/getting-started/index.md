---
title: Introduction
description: What SWEny is, how it works, and why the DAG matters.
---

SWEny runs workflows for coding agents. A workflow is a DAG of nodes, each with a focused instruction, scoped tools, and structured output. SWEny runs it on Claude Code, Codex, pi or an ACP agent under one set of rules, tracks every node, tool call and routing decision, and ends every run with a receipt.

## Your first run

```bash
npx @sweny-ai/core new      # pick a named workflow; explain-repo needs no skill credentials
npx @sweny-ai/core check    # preflight: is your agent logged in?
npx @sweny-ai/core workflow run .sweny/workflows/explain-repo.yml
```

You need a login or API key for the agent that runs your nodes (Claude Code by default). The [Quick Start](/getting-started/quick-start/) lists the credentials for each agent, shows the receipt you should see, and says what to do after. To replay a recorded demo first, run `sweny try` (sample data, not a real run).

## Why a DAG?

A single prompt that says "research competitors and write a report" works sometimes and fails unpredictably. SWEny splits that work into discrete nodes with explicit control flow:

- **Reliable** — each node has a focused instruction and scoped tools. If a node fails, you know exactly where and why.
- **Observable** — the executor emits structured events (`node:enter`, `tool:call`, `node:exit`, `route`) so you can log, trace, and audit every step.
- **Repeatable** — the same workflow definition produces the same execution path every time, regardless of who triggers it or where it runs.

## How it works

You don't need to write YAML. `sweny new` ("Describe your own") generates workflows from plain English, and `sweny workflow edit` modifies them. But here's what's happening under the hood:

```
  ┌─────────────┐
  │  Research    │  ← entry node
  │  Competitors │    skills: github
  └──────┬───────┘
         │
  ┌──────▼───────┐
  │  Gather      │    skills: github
  │  Data        │
  └──────┬───────┘
         │
  ┌──────▼───────┐
  │  Synthesize  │    (no external tools needed)
  └──┬───────┬───┘
     │       │
  when:    when:
  data     zero
  found    results
     │       │
  ┌──▼──────┐ ┌▼──────────┐
  │ Write   │ │ Flag Data  │
  │ Brief   │ │ Gap        │
  └─────────┘ └────────────┘
```

At each node, Claude receives the instruction, the tools from the node's skills, and context from all prior nodes. After a node completes, the executor evaluates edge conditions — written in natural language — to decide which node runs next.

The executor uses headless [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as the LLM backend. MCP servers for GitHub, Linear, Sentry, Datadog, and others are auto-injected based on your configuration.

## Three ways to use it

| Method | What it does |
|--------|--------------|
| **CLI** | Build and run workflows from your terminal. The primary way to create workflows and get things done. |
| **GitHub Action** | Deploy workflows to CI for scheduled automation. Built-in triage monitors production errors. |
| **Studio** | Visual DAG editor. Run it from a repo checkout; Live mode connects to an event URL you provide. |

## What people build with it

SWEny works for anything you can describe as a sequence of steps:

- **Content generation** — generate blog posts, run them through LLM quality judges, publish passing content (used for [kidmath.ai](https://kidmath.ai))
- **Security audits** — scan commits for secrets, review PRs, check dependencies, file tickets for findings
- **Competitive analysis** — research competitors, gather data, synthesize reports, create action items
- **Production triage** — monitor errors, investigate root causes, create issues, open fix PRs (built-in workflow)
- **Product launch prep** — research launches, draft copy with quality gates, create checklists

## Built-in workflows

SWEny ships two production-ready workflows:

**[Triage](/workflows/triage/)** — monitors your observability platform for errors, performs root cause analysis, creates an issue, and notifies your team. Runs on a schedule.

**[Implement](/workflows/implement/)** — takes an existing issue, analyzes the code, writes a fix, opens a PR, and notifies. Triggered manually or chained from Triage.

You can also [build custom workflows](/workflows/custom/) from natural language, YAML, or with the Studio visual editor.

## Next steps

- **[Quick Start](/getting-started/quick-start/)** — credentials, a named workflow, a preflight check, your first run and its receipt
- **[Core Concepts](/getting-started/concepts/)** — understand workflows, nodes, edges, and skills in depth
- **[CLI Examples](/cli/examples/)** — real-world workflow examples from one-liners to complex pipelines
- **[End-to-End Walkthrough](/getting-started/walkthrough/)** — follow a real triage run from error spike to fix PR
