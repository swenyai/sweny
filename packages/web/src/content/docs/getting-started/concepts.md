---
title: Core Concepts
description: Workflows, nodes, edges, skills, and the execution model that ties them together.
---

SWEny has four core primitives: **Workflow**, **Node**, **Edge**, and **Skill**. Everything else — the executor, the CLI, the GitHub Action, Studio — is built on top of these.

## Workflow

A **Workflow** is a directed acyclic graph (DAG) of nodes connected by edges. It has an `entry` node where execution starts. The executor walks the graph from entry to terminal (a node with no outgoing edges), running Claude at each step.

```ts
interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: Record<string, Node>;
  edges: Edge[];
  entry: string;
}
```

Workflows are pure data — fully serializable as JSON or YAML. You can export them, version them in git, edit them in Studio, and run them anywhere.

## Node

A **Node** is a single step in the workflow. It has a human-readable name, a natural-language instruction that tells Claude what to do, and a list of skill IDs that determine which tools Claude can use at this step.

```ts
interface Node {
  name: string;
  instruction: string;
  skills: string[];
  output?: JSONSchema;
}
```

The `instruction` field is the prompt Claude receives. Write it like you would write instructions for a capable engineer — be specific about what to do, what order, and what the output should look like.

The optional `output` field is a JSON Schema that constrains Claude's structured output for this node. Downstream nodes and edge conditions receive this structured data.

### Example: the Gather Context node from Triage

```yaml
gather:
  name: Gather Context
  instruction: |
    You are investigating a production alert. Gather all relevant context:
    1. Observability: Pull error details, stack traces, recent logs.
    2. Source control: Check recent commits and deploys.
    3. Issue tracker: Search for similar past issues.
  skills:
    - github
    - sentry
    - datadog
    - betterstack
    - linear
```

The node lists every compatible skill. The executor only activates skills that are configured in the current environment — if you use Sentry but not Datadog, Claude sees Sentry tools only.

## Edge

An **Edge** connects two nodes. Edges can be unconditional (always followed) or conditional — with a natural-language `when` clause that Claude evaluates at runtime based on prior node results.

```ts
interface Edge {
  from: string;
  to: string;
  when?: string;
}
```

### Edge resolution rules

| Scenario | Behavior |
|----------|----------|
| 0 outgoing edges | Node is terminal — workflow ends |
| 1 unconditional edge | Automatically followed |
| Multiple or conditional edges | Claude evaluates `when` clauses and picks the matching path |

### Example: routing after Root Cause Analysis

```yaml
edges:
  - from: investigate
    to: create_issue
    when: "The issue is novel (not a duplicate) and severity is medium or higher"
  - from: investigate
    to: skip
    when: "The issue is a duplicate of an existing ticket, or severity is low"
```

Claude reads the output of the `investigate` node and decides which condition matches. This replaces hard-coded if/else routing with flexible, natural-language branching.

## Skill

A **Skill** is a group of tools that share configuration. Skills connect Claude to external services — GitHub, Sentry, Linear, Slack, and others. You pick which skills are available at each node; Claude only sees the tools it needs.

```ts
interface Skill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  config: Record<string, ConfigField>;
  tools: Tool[];
}
```

Skills are configured through environment variables. Set `GITHUB_TOKEN` and the GitHub skill activates. Set `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` and the Sentry skill activates. No code required.

### Built-in skills

| Skill | Category | What Claude can do |
|-------|----------|--------------------|
| **GitHub** | git | Search code, read files, list commits, create issues, open PRs |
| **Linear** | tasks | Create, search, and update issues |
| **Sentry** | observability | List issues, get error details, search events |
| **Datadog** | observability | Search logs, query metrics, list monitors |
| **BetterStack** | observability | List incidents, check monitors, view on-call |
| **Slack** | notification | Send messages via webhook or bot API |
| **Notification** | notification | Discord, Teams, email, generic webhooks |

:::note[Skills are tool groups, not integrations]
A skill is not a monolithic integration. It is a bag of tools that Claude can call. The `github` skill gives Claude 7 tools (`github_search_code`, `github_get_issue`, `github_create_pr`, etc.). Claude decides which tools to use based on the node's instruction.
:::

## Execution model

The executor walks the DAG from `entry` to completion:

1. **Enter node** — the executor gathers tools from the node's skills and builds context from the input plus all prior node results.
2. **Run Claude** — Claude receives the instruction, context, and tools. It executes the instruction, calling tools as needed.
3. **Exit node** — the executor records the node result (status, data, tool calls made).
4. **Resolve edge** — the executor checks outgoing edges. If there is one unconditional edge, it follows it. If there are conditional edges, Claude evaluates the `when` clauses and picks the matching path.
5. **Repeat** — until a terminal node (no outgoing edges) is reached.

Every step emits structured `ExecutionEvent` objects — `workflow:start`, `node:enter`, `tool:call`, `tool:result`, `node:exit`, `route`, `workflow:end` — so you can observe, log, and trace the entire run.

## Next steps

- **[Quick Start](/getting-started/quick-start/)** — set up the GitHub Action in 5 minutes
- **[Skills Overview](/skills/)** — deep dive into each built-in skill
- **[Custom Workflows](/workflows/custom/)** — build your own DAG
