---
title: Concepts
description: Core concepts behind SWEny's workflow platform.
---

## Skills + DAG

Every SWEny workflow is a **directed acyclic graph** (DAG) of nodes. At each node, Claude receives an instruction and a set of **skills** — tools it can use to interact with external services. Claude does the work, then the executor evaluates edge conditions to decide which node runs next.

1. **Nodes** — Each node has a name, an instruction (what Claude should do), and a list of skills (tools Claude can use). Think of nodes as tasks in a pipeline.
2. **Edges** — Connect nodes. Edges can be unconditional (always taken) or conditional — with a natural-language `when` clause that Claude evaluates at runtime.
3. **Skills** — Groups of tools that connect Claude to external services. The `github` skill gives Claude tools to search code, manage issues, and open PRs. The `sentry` skill lets Claude query errors and stack traces.

## Workflow

A **Workflow** is a DAG of nodes connected by edges. The executor starts at the `entry` node and walks the graph until it reaches a terminal node (one with no outbound edges). Each node's output is available to downstream nodes.

Built-in workflows include **Triage** (monitor alerts, investigate, file tickets, notify) and **Implement** (analyze issue, write fix, open PR).

## Skills

**Skills** give Claude the ability to interact with your existing tools. You pick which skills are available at each node — Claude only sees the tools it needs.

| Skill | What Claude can do |
|-------|--------------------|
| **GitHub** | Search code, read files, create issues, open PRs |
| **Linear** | Create, search, and update issues |
| **Sentry** | Query errors, issues, and performance data |
| **Datadog** | Query logs, metrics, and monitors |
| **Slack** | Send messages via webhook or bot API |
| **Notification** | Discord, Teams, email, generic webhooks |

Skills are configured through environment variables (e.g. `GITHUB_TOKEN`, `DD_API_KEY`). No code required — set the env vars and the skill is ready.

## Edge conditions

Edges between nodes can carry natural-language conditions:

```yaml
edges:
  - from: investigate
    to: create_issue
    when: "The issue is novel and severity is medium or higher"
  - from: investigate
    to: skip
    when: "The issue is a duplicate or severity is low"
```

Claude evaluates these conditions based on what it learned at the source node. This replaces the old outcome-based routing with something more flexible and readable.

## Built-in workflows

**[Triage](/recipes/triage/)** automates the on-call triage loop — gather context from logs, investigate root cause, create an issue, and notify the team.

**[Implement](/recipes/implement/)** takes an existing issue and produces a fix PR — analyze the issue, implement the fix, open a PR, and notify.

See [Workflow Authoring](/studio/recipe-authoring/) to build your own workflows.
