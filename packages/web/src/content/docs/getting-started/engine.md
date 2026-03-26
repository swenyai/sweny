---
title: Core & Workflows
description: How SWEny's DAG executor orchestrates AI-powered engineering workflows with skills.
---

SWEny's core runs your workflow automatically — you define what Claude should do at each node and which skills (tools) it needs. The executor walks the DAG, running Claude at each node with the specified tools, and uses natural-language edge conditions to decide the path.

## How it works

### Nodes

Each node in the workflow gives Claude:

- An **instruction** — a detailed prompt describing the task
- A list of **skills** — tool groups Claude can use (e.g. `github`, `sentry`, `slack`)
- An optional **output schema** — structured data Claude should return

Claude reads the instruction, uses the available tools, and produces a result. The executor captures tool calls, outputs, and status.

### Edges

Edges connect nodes. They can be:

- **Unconditional** — always taken (e.g. `gather → investigate`)
- **Conditional** — taken only when a natural-language `when` condition is met (e.g. `investigate → create_issue` when "severity is medium or higher")

When a node has multiple outbound edges, Claude evaluates the conditions and picks the best match.

### Skills

Skills are groups of tools that connect Claude to external services:

- **GitHub** — search code, get issues, create PRs, list commits
- **Linear** — create issues, search issues, update issues
- **Sentry** — list issues, get issue details, search events
- **Datadog** — search logs, list monitors, query metrics
- **Slack** — send messages via webhook or bot API
- **Notification** — Discord webhooks, Teams webhooks, email, generic webhooks

Skills are configured via environment variables. Set `GITHUB_TOKEN` and the GitHub skill works. Set `DD_API_KEY` + `DD_APP_KEY` and Datadog is ready.

## Built-in workflows

### Triage

Automates the on-call triage loop:

1. **Gather** — query logs from Sentry/Datadog, check recent commits on GitHub, search for similar issues in Linear
2. **Investigate** — correlate errors with code changes, determine root cause, assess severity
3. **Create Issue** — file a detailed ticket with root cause analysis
4. **Notify** — send a summary to Slack/Discord/email

Conditional edges let the workflow skip straight to a "done" node when the issue is a known duplicate or low severity.

See [Quick Start](/getting-started/) to set up Triage in your repo.

### Implement

Takes an existing issue identifier and produces a fix PR:

1. **Analyze** — fetch issue details, read relevant source files, plan the fix
2. **Implement** — create a branch, make changes, commit
3. **Open PR** — push and create a pull request
4. **Notify** — send the result to your team

If the fix is too complex or risky, a conditional edge routes to a "skip" node that comments on the issue instead.

## What's next

- [Quick Start](/getting-started/) — add Triage to your repo in 5 minutes
- [Workflow Authoring](/studio/recipe-authoring/) — build a custom workflow with your own nodes and skills
- [Studio](/studio/) — visual editor for designing and monitoring workflows
