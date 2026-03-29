---
title: Introduction
description: What SWEny is, how it works, and why the DAG matters.
---

SWEny is a **workflow orchestration layer** for AI-powered engineering tasks. You define a directed acyclic graph (DAG) of nodes — each with a natural-language instruction and a set of skills (tools) — and SWEny's executor walks the graph, running Claude at every step. The result is reliable, observable, repeatable automation.

## Why a DAG?

Ad-hoc prompting is brittle. A single prompt that says "investigate errors, create a ticket, open a PR" works sometimes and fails unpredictably. SWEny splits that work into discrete nodes with explicit control flow:

- **Reliable** — each node has a focused instruction and scoped tools. If a node fails, you know exactly where and why.
- **Observable** — the executor emits structured events (`node:enter`, `tool:call`, `node:exit`, `route`) so you can log, trace, and audit every step.
- **Repeatable** — the same workflow definition produces the same execution path every time, regardless of who triggers it or where it runs.

## How it works

A SWEny workflow looks like this:

```
  ┌─────────────┐
  │   Gather     │  ← entry node
  │   Context    │    skills: github, sentry
  └──────┬───────┘
         │
  ┌──────▼───────┐
  │  Root Cause  │    skills: github
  │  Analysis    │
  └──┬───────┬───┘
     │       │
  when:    when:
  novel    duplicate
  & med+   or low
     │       │
  ┌──▼────┐  ┌▼──────┐
  │Create │  │ Skip  │
  │ Issue │  └───────┘
  └──┬────┘
     │
  ┌──▼────┐
  │Notify │  skills: slack, notification
  │ Team  │
  └───────┘
```

This is the built-in **Triage** workflow. At each node, Claude receives the instruction, the tools from the node's skills, and context from prior nodes. After a node completes, the executor evaluates edge conditions — written in natural language — to decide which node runs next.

## Four ways to run

| Method | Best for | Setup time |
|--------|----------|------------|
| **GitHub Action** (recommended) | Scheduled automation in CI | 5 minutes |
| **CLI** | Local development and testing | 2 minutes |
| **Studio** | Visual workflow editing and live execution | Browser-based |
| **[SWEny Cloud](https://app.sweny.ai)** | Teams — dashboard, shared credentials, analytics | 5 minutes |

The GitHub Action is the primary deployment target. It runs on a cron schedule, triggers from `workflow_dispatch`, and writes results to the GitHub Actions summary. The CLI is useful for iterating locally. Studio provides a visual DAG editor built on React Flow. [SWEny Cloud](https://app.sweny.ai) wraps everything in a managed platform with job history, team credential management, scheduled runs, and cross-repo analytics.

## Built-in workflows

SWEny ships two production-ready workflows:

**[Triage](/workflows/triage/)** — monitors your observability platform for errors, performs root cause analysis, creates an issue, and notifies your team. Runs on a schedule.

**[Implement](/workflows/implement/)** — takes an existing issue, analyzes the code, writes a fix, opens a PR, and notifies. Triggered manually or chained from Triage.

You can also [build custom workflows](/workflows/custom/) in YAML or with the Studio visual editor.

## Next steps

- **[Core Concepts](/getting-started/concepts/)** — understand workflows, nodes, edges, and skills in depth
- **[Quick Start](/getting-started/quick-start/)** — get SWEny running in your repo in 5 minutes
- **[End-to-End Walkthrough](/getting-started/walkthrough/)** — follow a real triage run from error spike to fix PR
- **[SWEny Cloud](https://app.sweny.ai)** — managed platform with dashboard, team credentials, and analytics
