---
title: How Workflows Work
description: Understanding SWEny's DAG-based workflow execution model.
---

A workflow is a directed acyclic graph (DAG) of nodes connected by edges, with a single entry point. Each node gives Claude an instruction and a set of skills (tools). Edges define the flow between nodes, optionally with natural-language conditions that Claude evaluates at runtime.

This is SWEny's core abstraction. Instead of writing procedural automation scripts, you declare **what** should happen at each step and **when** to move between steps. Claude handles the execution.

## Anatomy of a workflow

Every workflow has four parts:

| Field | Purpose |
|-------|---------|
| **id** | Unique identifier (used in CLI commands and exports) |
| **name** | Human-readable display name |
| **entry** | The node where execution begins |
| **nodes** | A map of node definitions, each with an instruction and skills |
| **edges** | Connections between nodes, optionally with `when` conditions |

Here is the TypeScript interface from `@sweny-ai/core`:

```typescript
interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: Record<string, Node>;
  edges: Edge[];
  entry: string;
}

interface Node {
  name: string;
  instruction: string;
  skills: string[];
  output?: JSONSchema;
}

interface Edge {
  from: string;
  to: string;
  when?: string;
}
```

## Execution model

The executor walks the graph node-by-node, starting at the entry node, until it reaches a terminal node (one with no outgoing edges).

**Step-by-step:**

1. **Start at the entry node.** The executor looks up `workflow.entry` in the node map.
2. **Build context.** Claude receives the node's `instruction`, the workflow input, and the accumulated results from all prior nodes.
3. **Resolve tools.** The executor gathers tools from every skill listed in the node's `skills` array.
4. **Claude executes.** Claude runs the instruction, calling tools as needed (querying APIs, reading files, creating issues, etc.).
5. **Collect the result.** Claude returns a `NodeResult` with a status (`success`, `skipped`, or `failed`), arbitrary data, and a record of all tool calls made.
6. **Route to the next node.** The executor evaluates outgoing edges. If there is a single unconditional edge, it follows it. If there are conditional edges, Claude evaluates the `when` clauses against the current results and picks a path.
7. **Repeat** until reaching a terminal node.

```typescript
interface NodeResult {
  status: "success" | "skipped" | "failed";
  data: Record<string, unknown>;
  toolCalls: ToolCall[];
}
```

## Conditional routing

Edges can have a `when` clause written in natural language. At runtime, Claude evaluates each condition against the current node's result and picks the matching path.

```yaml
edges:
  - from: investigate
    to: create_issue
    when: "The issue is novel (not a duplicate) and severity is medium or higher"
  - from: investigate
    to: skip
    when: "The issue is a duplicate of an existing ticket, or severity is low"
```

The executor presents all outgoing conditions as choices and asks Claude to pick one. If an edge has no `when` clause, it acts as a default/unconditional path.

:::note[How routing works internally]
When a node has multiple outgoing edges, the executor calls `claude.evaluate()` with the conditions as choices and the accumulated context. Claude returns the ID of the chosen target node. If Claude returns an invalid target, the executor falls back to the default edge or the first edge.
:::

## Structured output

Nodes can declare an `output` schema (JSON Schema). When present, Claude's response is validated against the schema, producing structured data that downstream nodes and routing conditions can reference.

```yaml
investigate:
  name: Root Cause Analysis
  instruction: "Classify every distinct issue as novel or duplicate..."
  skills: [github, linear]
  output:
    type: object
    properties:
      findings:
        type: array
        items:
          type: object
          properties:
            title: { type: string }
            root_cause: { type: string }
            severity: { type: string, enum: [critical, high, medium, low] }
            is_duplicate: { type: boolean }
            fix_complexity: { type: string, enum: [simple, moderate, complex] }
          required: [title, root_cause, severity, is_duplicate]
      novel_count: { type: number }
      highest_severity: { type: string, enum: [critical, high, medium, low] }
    required: [findings, novel_count, highest_severity]
```

This is how the triage workflow's conditional routing works: the `investigate` node outputs a `findings` array where each item is classified as novel or duplicate. The `novel_count` and `highest_severity` fields drive edge conditions.

## Dry run

Pass `dryRun: true` (CLI: `--dry-run`, Action: `dry-run: true`) to run a workflow in analysis-only mode. The executor processes nodes normally — Claude queries logs, searches code, analyzes errors — but **stops before any action that requires a routing decision**.

Specifically: after each node completes, the executor checks outgoing edges. If any edge has a `when` condition (a conditional branch), execution stops and returns the results so far. Unconditional edges are followed normally because they represent analysis flow, not action decisions.

**This is a hard gate enforced by the executor, not a prompt instruction.** Claude cannot bypass it. The routing check is in the executor code itself — if `dryRun` is true and a conditional edge exists, the executor halts regardless of what Claude returns.

In practice:
- **Triage workflow:** runs `prepare` → `gather` → `investigate`, then stops. You get the full investigation report but no issues are created, no PRs opened, no notifications sent.
- **Implement workflow:** runs `analyze`, then stops. You get the analysis and fix plan but no code changes are made.

## Execution events

The executor emits events at every stage. Pass an `observer` function to receive them in real-time:

```typescript
type ExecutionEvent =
  | { type: "workflow:start"; workflow: string }
  | { type: "node:enter"; node: string; instruction: string }
  | { type: "node:progress"; node: string; message: string }
  | { type: "tool:call"; node: string; tool: string; input: unknown }
  | { type: "tool:result"; node: string; tool: string; output: unknown }
  | { type: "node:exit"; node: string; result: NodeResult }
  | { type: "route"; from: string; to: string; reason: string }
  | { type: "workflow:end"; results: Record<string, NodeResult> };

type Observer = (event: ExecutionEvent) => void;
```

The CLI uses these events to render a live DAG visualization in your terminal. Studio uses them for live mode. You can also use them for logging, metrics, or custom integrations.

## Validation

SWEny validates every workflow before execution. The `validateWorkflow()` function checks:

| Rule | Error code |
|------|-----------|
| Entry node must exist in the node map | `MISSING_ENTRY` |
| All edge `from` values must reference existing nodes | `UNKNOWN_EDGE_SOURCE` |
| All edge `to` values must reference existing nodes | `UNKNOWN_EDGE_TARGET` |
| No edge may reference the same node as both source and target | `SELF_LOOP` |
| All nodes must be reachable from the entry node (BFS) | `UNREACHABLE_NODE` |
| Referenced skills must exist in the skill catalog (optional) | `UNKNOWN_SKILL` |

You can validate a workflow file without running it:

```bash
sweny workflow validate my-workflow.yml
```

## Built-in workflows

SWEny ships with two built-in workflows:

- **[Triage](/workflows/triage/)** -- investigate a production alert, determine root cause, create an issue, and notify the team.
- **[Implement](/workflows/implement/)** -- analyze an issue, implement a fix, open a PR, and notify the team.

You can export either as YAML and use it as a starting point for customization:

```bash
sweny workflow export triage > my-triage.yml
sweny workflow export implement > my-implement.yml
```

## What's next?

- [Triage Workflow](/workflows/triage/) -- the built-in alert investigation workflow
- [Implement Workflow](/workflows/implement/) -- the built-in issue-to-PR workflow
- [Custom Workflows](/workflows/custom/) -- write your own workflows in YAML
- [YAML Reference](/workflows/yaml-reference/) -- full schema reference
