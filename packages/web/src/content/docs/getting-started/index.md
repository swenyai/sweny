---
title: Introduction
description: What SWEny is, how it works, and why the DAG matters.
---

SWEny turns natural language into reliable AI workflows. Describe what you want done, and SWEny builds a DAG — a directed acyclic graph of nodes, each with a focused instruction, scoped tools, and structured output. Then it runs it, tracking every node, tool call, and routing decision.

```bash
sweny workflow create "research competitors, gather pricing and features, \
  synthesize a comparison, and produce an executive brief"
```

One sentence in, a full workflow out. Refine it with natural language, run it immediately, or deploy it to GitHub Actions.

## Why a DAG?

A single prompt that says "research competitors and write a report" works sometimes and fails unpredictably. SWEny splits that work into discrete nodes with explicit control flow:

- **Reliable** — each node has a focused instruction and scoped tools. If a node fails, you know exactly where and why.
- **Observable** — the executor emits structured events (`node:enter`, `tool:call`, `node:exit`, `route`) so you can log, trace, and audit every step.
- **Repeatable** — the same workflow definition produces the same execution path every time, regardless of who triggers it or where it runs.

## How it works

You don't need to write YAML. `sweny workflow create` generates workflows from plain English, and `sweny workflow edit` modifies them. But here's what's happening under the hood:

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
| **Studio** | Visual DAG editor and live execution monitor. Watch workflows run node-by-node. |

**[SWEny Cloud](https://app.sweny.ai)** adds the team layer — dashboard, shared credentials, scheduling, and cross-repo analytics.

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

- **[Quick Start](/getting-started/quick-start/)** — install and create your first workflow in under a minute
- **[Core Concepts](/getting-started/concepts/)** — understand workflows, nodes, edges, and skills in depth
- **[CLI Examples](/cli/examples/)** — real-world workflow examples from one-liners to complex pipelines
- **[End-to-End Walkthrough](/getting-started/walkthrough/)** — follow a real triage run from error spike to fix PR
