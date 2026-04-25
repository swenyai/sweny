---
title: YAML Reference
description: Complete schema reference for workflow definition files.
---

This is the complete schema reference for SWEny workflow YAML files. Every field, every validation rule, every constraint.

## Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique workflow identifier. Used in CLI commands, exports, and event payloads. |
| `name` | string | Yes | Human-readable display name. Shown in CLI output, Studio, and notifications. |
| `description` | string | No | What this workflow does. Defaults to empty string. |
| `entry` | string | Yes | ID of the entry node. Execution starts here. |
| `nodes` | object | Yes | Map of node ID to node definition. Keys are the node IDs. |
| `edges` | array | Yes | Array of edge objects defining the graph structure. |

## Node definition

Each key in the `nodes` object is a node ID (an arbitrary string you choose). The value is a node definition:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | -- | Display name for this node. |
| `instruction` | string | Yes | -- | Natural language instruction telling Claude what to do at this step. |
| `skills` | string[] | No | `[]` | Skill IDs whose tools should be available at this node. |
| `output` | object | No | -- | JSON Schema for structured output validation. |
| `eval` | array | No | -- | Named evaluators run after the LLM finishes. See [Eval reference on spec.sweny.ai](https://spec.sweny.ai/nodes/#eval). |
| `requires` | object | No | -- | Pre-conditions evaluated before the LLM runs. See [Requires reference](https://spec.sweny.ai/nodes/#requires). |
| `retry` | object | No | -- | Node-local retry on eval failure. See [Retry reference](https://spec.sweny.ai/nodes/#retry). |
| `rules` | array \| object | No | inherited | Per-node directives, cascading from workflow level. See [Rules & Context](https://spec.sweny.ai/nodes/#rules--context). |
| `context` | array \| object | No | inherited | Per-node background knowledge, cascading from workflow level. See [Rules & Context](https://spec.sweny.ai/nodes/#rules--context). |
| `max_turns` | integer | No | implementation-defined | Cap on AI model turns for this node. See [Max Turns Semantics](https://spec.sweny.ai/nodes/#max-turns-semantics). |

### Instructions

The `instruction` field is the core of each node. Write it as you would write a prompt for Claude -- clear, specific, and focused on a single task. Claude receives the instruction along with the workflow input and all prior node results as context.

Good instructions:
- Focus on one task per node
- List explicit steps (numbered or bulleted)
- Specify what tools to use and what to look for
- State what output is expected

### Skills

The `skills` array lists skill IDs that should be available at this node. Each skill provides a set of tools that Claude can call.

Available skill IDs:

| Skill ID | Category | Tools provided |
|----------|----------|----------------|
| `github` | git | Repository operations, PRs, issues, file read/write, code search |
| `linear` | tasks | Issue CRUD, project/team queries, comments |
| `sentry` | observability | Error search, issue details, event data, releases |
| `datadog` | observability | Log search, metric queries, monitor status |
| `betterstack` | observability | Incident list, log search |
| `slack` | notification | Send messages, search channels |
| `notification` | notification | Discord, Teams, webhook, and email notifications |

:::note[Skill availability at runtime]
A node can list skills that may not be configured. At execution time, the executor only loads skills that have valid credentials. This lets the same workflow work across different environments without modification.
:::

### Output schema

The `output` field accepts a JSON Schema object. When present, Claude's response is validated against this schema, and the resulting structured data is available to downstream nodes and routing conditions.

```yaml
output:
  type: object
  properties:
    severity:
      type: string
      enum: [critical, high, medium, low]
    root_cause:
      type: string
    is_fixable:
      type: boolean
  required: [severity, root_cause]
```

Any valid JSON Schema is accepted. Common patterns:
- `enum` to constrain values for routing conditions
- `required` to ensure key fields are always present
- `type: array` with `items` for lists

## Edge definition

Each entry in the `edges` array is an edge object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Source node ID. |
| `to` | string | Yes | Target node ID. |
| `when` | string | No | Natural language condition. Claude evaluates this at runtime. |

### Unconditional edges

An edge without a `when` clause is unconditional -- the executor always follows it. Use these for linear sequences:

```yaml
edges:
  - from: gather
    to: analyze
  - from: analyze
    to: report
```

If a node has exactly one outgoing edge and that edge is unconditional, the executor follows it without invoking Claude for a routing decision.

### Conditional edges

An edge with a `when` clause is conditional. The `when` value is natural language that Claude evaluates against the current node's result:

```yaml
edges:
  - from: analyze
    to: fix
    when: "The issue is fixable with a simple code change"
  - from: analyze
    to: escalate
    when: "The issue requires infrastructure changes or human review"
```

When a node has multiple outgoing conditional edges, the executor presents all conditions as choices and asks Claude to pick the one that matches. If one edge is unconditional among conditional siblings, it acts as the default/fallback path.

### Terminal nodes

A node with no outgoing edges is a terminal node. When the executor reaches a terminal node, the workflow ends. Every workflow must have at least one terminal node (otherwise execution would never stop).

## Complete example

```yaml
id: deploy-check
name: Deployment Health Check
description: Verify a deployment succeeded and take action if it didn't
entry: check_health

nodes:
  check_health:
    name: Check Deployment Health
    instruction: |
      Check the health of the most recent deployment:
      1. Look at error rates in the last 15 minutes
      2. Check for new error types that appeared after deploy
      3. Compare latency metrics before and after deploy
    skills: [datadog, sentry]
    output:
      type: object
      properties:
        status:
          type: string
          enum: [healthy, degraded, failing]
        error_rate_change:
          type: number
        new_errors:
          type: array
          items:
            type: string
        latency_p99_ms:
          type: number
      required: [status]

  rollback:
    name: Trigger Rollback
    instruction: |
      The deployment is failing. Create an urgent issue recommending rollback.
      Include the specific errors and metrics that indicate failure.
    skills: [github, slack]

  investigate:
    name: Investigate Degradation
    instruction: |
      The deployment shows degraded performance. Investigate whether this
      is expected (e.g., cache warming) or a real problem. Check if
      metrics are trending back toward normal.
    skills: [datadog, github]

  report_healthy:
    name: Report Healthy
    instruction: |
      Deployment looks good. Post a brief confirmation to the team channel.
    skills: [slack]

edges:
  - from: check_health
    to: rollback
    when: "Deployment status is failing"
  - from: check_health
    to: investigate
    when: "Deployment status is degraded"
  - from: check_health
    to: report_healthy
    when: "Deployment status is healthy"
```

## Validation rules

SWEny validates workflows before execution. The `sweny workflow validate` command runs the same checks. Every rule is listed below.

| Rule | Error code | Description |
|------|-----------|-------------|
| Entry exists | `MISSING_ENTRY` | The `entry` value must match a key in `nodes`. |
| Valid edge sources | `UNKNOWN_EDGE_SOURCE` | Every edge `from` must reference an existing node ID. |
| Valid edge targets | `UNKNOWN_EDGE_TARGET` | Every edge `to` must reference an existing node ID. |
| Bounded self-loops | `SELF_LOOP` | An edge where `from` equals `to` must declare `max_iterations`. Bounded self-loops are allowed — only unbounded ones are rejected. |
| All nodes reachable | `UNREACHABLE_NODE` | Every node must be reachable from the entry node via BFS traversal. |
| No unbounded cycles | `UNBOUNDED_CYCLE` | Any cycle must have at least one edge with `max_iterations`. The detector removes bounded edges, then checks the remaining subgraph for cycles. |
| Known skills | `UNKNOWN_SKILL` | If a skill catalog is provided, all referenced skill IDs must exist in it. |
| Valid inline skills | `INVALID_INLINE_SKILL` | Inline `skills` entries in a workflow must declare `instruction`, `mcp`, or both. |

Validation runs in two phases. First, structural checks (entry exists, edges reference valid nodes, bounded self-loops, no unbounded cycles). If those pass, reachability is checked via breadth-first search from the entry node.

## JSON Schema

SWEny publishes a static JSON Schema for workflow files. Use it for editor autocomplete, CI validation, or integration with other tools:

```
https://spec.sweny.ai/schemas/workflow.json
```

The schema is generated from the same Zod types the runtime uses, so it always reflects the current `@sweny-ai/core` release. The full field reference, with all node sub-objects (`eval`, `requires`, `retry`, etc.), lives at [spec.sweny.ai/nodes](https://spec.sweny.ai/nodes/).

Reference the schema in your YAML editor by adding a schema comment:

```yaml
# yaml-language-server: $schema=https://spec.sweny.ai/schemas/workflow.json
id: my-workflow
name: My Workflow
# ...
```

## CLI commands

| Command | Description |
|---------|-------------|
| `sweny workflow validate <file>` | Validate a workflow YAML/JSON file. Exit 0 if valid, 1 if errors. |
| `sweny workflow run <file>` | Execute a workflow file. |
| `sweny workflow run <file> --dry-run` | Validate and show structure without running. |
| `sweny workflow run <file> --json` | Output results as JSON on stdout. |
| `sweny workflow export triage` | Print the built-in triage workflow as YAML. |
| `sweny workflow export implement` | Print the built-in implement workflow as YAML. |
| `sweny workflow create <description>` | Generate a workflow from a natural-language description. |
| `sweny workflow create <description> --json` | Generate and output as JSON (non-interactive). |
| `sweny workflow edit <file> [instruction]` | Edit a workflow file with natural-language instructions. |
| `sweny workflow list` | List all available skills. |
| `sweny workflow list --json` | List skills as JSON array. |
