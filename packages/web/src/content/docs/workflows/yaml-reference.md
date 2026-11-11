---
title: YAML Reference
description: Complete schema reference for workflow definition files.
---

This is the complete schema reference for SWEny workflow YAML files. Every field, every validation rule, every constraint.

## Top-level fields

| Field          | Type             | Required | Description                                                                                                          |
| -------------- | ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`           | string           | Yes      | Unique workflow identifier. Used in CLI commands, exports, and event payloads.                                       |
| `name`         | string           | Yes      | Human-readable display name. Shown in CLI output, Studio, and notifications.                                         |
| `description`  | string           | No       | What this workflow does. Defaults to empty string.                                                                   |
| `entry`        | string           | Yes      | ID of the entry node. Execution starts here.                                                                         |
| `nodes`        | object           | Yes      | Map of node ID to node definition. Keys are the node IDs.                                                            |
| `edges`        | array            | Yes      | Array of edge objects defining the graph structure.                                                                  |
| `budget`       | object           | No       | `{ tokens, cost_usd }`: spend ceiling for the whole run and for every node. See [Spend budgets](#spend-budgets).     |
| `permissions`  | string \| object | No       | Default and ceiling for every node's permissions. See [Permissions and safe outputs](#permissions-and-safe-outputs). |
| `safe_outputs` | object           | No       | Run-wide limits on safe outputs: allowed types, total cap, staged preview, trusted actors, optional screen.          |

## Node definition

Each key in the `nodes` object is a node ID (an arbitrary string you choose). The value is a node definition:

| Field         | Type             | Required | Default                | Description                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ---------------- | -------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string           | Yes      | --                     | Display name for this node.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `instruction` | string           | Yes      | --                     | Natural language instruction telling the coding agent what to do at this step.                                                                                                                                                                                                                                                                                                                                                    |
| `skills`      | string[]         | No       | `[]`                   | Skill IDs whose tools should be available at this node.                                                                                                                                                                                                                                                                                                                                                                           |
| `output`      | object           | No       | --                     | JSON Schema for structured output validation.                                                                                                                                                                                                                                                                                                                                                                                     |
| `eval`        | array            | No       | --                     | Named evaluators run after the LLM finishes. See [Eval reference on spec.sweny.ai](https://spec.sweny.ai/nodes/#eval).                                                                                                                                                                                                                                                                                                            |
| `requires`    | object           | No       | --                     | Pre-conditions evaluated before the LLM runs. See [Requires reference](https://spec.sweny.ai/nodes/#requires).                                                                                                                                                                                                                                                                                                                    |
| `retry`       | object           | No       | --                     | Node-local retry on eval failure. See [Retry reference](https://spec.sweny.ai/nodes/#retry).                                                                                                                                                                                                                                                                                                                                      |
| `rules`       | array \| object  | No       | inherited              | Per-node directives, cascading from workflow level. See [Rules & Context](https://spec.sweny.ai/nodes/#rules--context).                                                                                                                                                                                                                                                                                                           |
| `context`     | array \| object  | No       | inherited              | Per-node background knowledge, cascading from workflow level. See [Rules & Context](https://spec.sweny.ai/nodes/#rules--context).                                                                                                                                                                                                                                                                                                 |
| `max_turns`   | integer          | No       | implementation-defined | Cap on AI model turns for this node. See [Max Turns Semantics](https://spec.sweny.ai/nodes/#max-turns-semantics).                                                                                                                                                                                                                                                                                                                 |
| `budget`      | object           | No       | --                     | `{ tokens, cost_usd }`: spend ceiling for one visit to this node, retries included. Never above the workflow's. See [Spend budgets](#spend-budgets).                                                                                                                                                                                                                                                                              |
| `permissions` | string \| object | No       | see below              | `read` or `write`, or `{ access, deny, allow, strict }`. See [Permissions and safe outputs](#permissions-and-safe-outputs).                                                                                                                                                                                                                                                                                                              |
| `outputs`     | array            | No       | --                     | Typed writes (`comment`, `issue`, `pr`, `label`, `issue_state`, `slack_message`, `email`) the node may request. sweny applies them after the node.                                                                                                                                                                                                                                                                                                          |
| `agent_env`   | string[]         | No       | --                     | Secrets this node's agent process gets in its env. By default the agent never holds a skill credential (`GITHUB_TOKEN`, `LINEAR_API_KEY`, ...): skill tools run in sweny. A name here can be used outside sweny's opinions (any API call, any push). Not allowed on a `permissions: read` node; withheld in a staged or dry run. See [Skill credentials stay in SWEny](/advanced/agent-sandbox/#skill-credentials-stay-in-sweny). |

### Spend budgets

```yaml
budget: # workflow: the whole run, and the ceiling for every node
  tokens: 500000
  cost_usd: 5
nodes:
  investigate:
    budget: { tokens: 200000 } # one visit to this node
```

The executor's own model calls (judge, route, retry reflection, the safe-output screen) count toward the budget too, not just the agent's node runs. A workflow that fit before can stop at a judge, at a screen or between nodes; raise `budget.tokens` / `budget.cost_usd`, or `--max-tokens` / `--max-cost` (Action `max-tokens` / `max-cost`), if it does. `trace.spend` and the receipt show the split.

Tokens are input plus output as the harness reports them (cache tokens are not counted); cost is the agent's own reported USD, never estimated. `sweny workflow run --max-tokens` and `--max-cost` (Action inputs `max-tokens`, `max-cost`) tighten the run ceiling; the lowest value wins. The ceiling covers the whole logical run: [`sweny workflow resume`](/cli/resume/) starts from the spend the journal recorded before the crash.

When a node's spend crosses its budget, or the run's, sweny stops the agent, fails the node with a budget reason (`fail_soft` and `on_fail: continue` do not apply), and ends the run without starting another node. The receipt shows the overrun. A node is not started once the run's budget is already spent.

How tightly it is kept depends on what the agent reports while it works:

| Agent                 | Tokens                                                                                                     | Cost                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Claude Code           | Stopped mid-node, from each message's usage (a lower bound; the final total is checked when the node ends) | Checked when the node ends            |
| Codex                 | Checked when the node ends                                                                                 | Not reported: cannot be enforced      |
| pi                    | Checked when the node ends                                                                                 | Checked when the node ends            |
| ACP (`acp:<command>`) | Not reported: cannot be enforced                                                                           | Stopped mid-node, from `usage_update` |

"Checked when the node ends" means one node can overrun before it is stopped; the node reports `budget_live` as degraded. "Cannot be enforced" reports `budget_tokens` or `budget_cost_usd` as degraded and enforces nothing for that unit; under `--harness-policy strict` (the default under GitHub Actions) the node is refused before it starts.

The executor's own calls count when the harness reports usage for them; a call that reports none adds nothing. Judge, reflection and screen calls count against the node's budget and the run's, agent route evaluations against the run's. With a budget on, a node's judges run one at a time. The stop applies to the total: a judge that crosses a ceiling fails its node, a screen that crosses one vetoes the writes not yet applied and fails its node, and a route call that crosses the run's keeps the next node from starting (or, when the route ends the run, fails the node it left; a resume with a larger cap then routes on from a node that had succeeded, and runs a node that had failed again). No judge, reflection, screen or route call starts once a ceiling is reached, and a node is not started (even one its `requires` would skip) once the run's is. The decision model (`route_by: decider`) is not metered, and is not asked once the run's budget is spent; the receipt's `decider off` says so. Spend by kind (`node`, `judge`, `route`, `reflect`, `screen`) is on `trace.spend`, in the run summary's `spend` and on the run history record, present only when one of the executor's own calls reported usage; the receipt's totals are then its sum. All of it is journaled, so a resume keeps every kind.

### Permissions and safe outputs

A node that only needs to read should not hold write tools. Declare what it may write instead, and let sweny do the write after the agent finishes:

```yaml
nodes:
  report:
    name: File the crash
    instruction: If the logs show a new crash, file one issue with the stack trace.
    skills: [github, sentry]
    outputs:
      - type: issue
        title_prefix: "[sweny] "
        labels: [sweny]
        max: 1
safe_outputs:
  max: 3
  trusted_associations: [OWNER, MEMBER, COLLABORATOR]
```

- A node with `outputs` runs read-only: it gets read tools plus `emit_output`, no write tools, no external skill MCP servers, and no shell, file-write, edit, fetch or subagent built-ins.
- `emit_output` only records the request. After the node succeeds, sweny checks each request (declared type, allowed types, trusted actor, expiry, target, labels, title prefix, duplicates, caps) and then calls the skill's own write tool. An optional `safe_outputs.screen` model call can veto the writes, never approve extra ones.
- A `comment`, `label` or `issue_state` output can be pinned to one issue or PR with `number`: a literal (`number: 42`, `number: OFF-12`) or a run input (`number: { input: pr_number }`). A request for any other issue is refused, a request with no number uses the pin, and an empty pinned input refuses the write. A pinned GitHub output is pinned to one repository too: `target` (a literal, or a run input with `target: { input: repo }`), else `GITHUB_REPOSITORY`. A repository named by the agent is never used; with neither, the write is refused.
- An `issue_state` output reopens or closes an existing issue (`state: reopen` or `state: close` on the declaration limits it to one; `max` caps it, default 1). A reopen may name its issue in the request (triage does), or the declaration may pin one. A close must be pinned on the declaration (`number: 42` or `number: { input: issue }`): an unpinned close fails validation, and a close naming any other issue is refused, so an injected agent cannot close arbitrary issues. A close also needs a pinned repository: the declaration's `target`, else `GITHUB_REPOSITORY` (GitHub), else the declared team (Linear); with none, it is refused ("close needs a pinned repository"), and a close naming a different repository is refused. A request that names no issue and has no pin is refused. Linear issues are checked against the declared `target` team first. Reopening an open issue or closing a closed one changes nothing. Triage uses `{ type: issue_state, state: reopen, max: 10 }` to reopen closed duplicates.
- The next nodes see what was written as `context.<node>.safe_outputs`: one receipt per request with `type`, `status` (`applied`, `staged`, `skipped`, `refused`, ...), and for an applied write its `ref` (issue number or identifier) and `url`. That is how a later step uses the identifier of an issue it did not create itself. An agent cannot fake this field.
- `permissions: read` makes any node read-only without outputs. `permissions: { deny: [shell, net] }` removes those built-in tool classes on any agent runtime. A `write` node gets read and search tools plus the shell, file-write, edit and web built-ins, nothing else; `permissions: { access: write, allow: [subagent] }` adds subagents. Codex has no built-in allow-list, so sweny turns off the Codex built-ins it knows and reports that; an ACP agent keeps all its own built-ins, so `strict` refuses its write nodes. `strict: true` loads only the MCP servers sweny injects; on an agent runtime that cannot keep the user's own MCP servers out, `strict` refuses the node before it starts.
- Preview with `sweny workflow run <file> --stage` (or `safe_outputs.staged: true`): sweny prints each write it would make and makes none. `--dry-run` also stages.
- `slack_message` (via `slack`, `body` is the text) and `email` (via `notification`, over `SMTP_URL` from `SMTP_FROM`; `title` is the subject; the recipient must also be on the operator's `SMTP_ALLOWED_RECIPIENTS`) need `spec_version: "3"` and must pin `target`: a Slack channel id or an email address, literal or `{ input: name }`. The agent never picks where a message goes. Slack and SMTP have no way to look a message up, so a send whose outcome is unknown is never repeated.
- Approval mode (`spec_version: "3"`): with `safe_outputs.approval: { required: true }`, nothing is sent during the run. Each node's writes that pass every check are frozen, exact arguments and destination included, into a bundle in the run's private state dir, and the receipts say `pending` with the bundle's `digest`. `sweny publish <run-id>` verifies and prints the bundle; `sweny publish <run-id> --approve` sends it once. `expires` (default `7d`) bounds how long a bundle stays publishable, and `approvers` (for example `[local:nate]`) limits who may approve. A `pr` output never waits for approval: it is refused in approval mode. In approval mode no node holds a direct write either: write tools, skill MCP servers, `git push` and `agent_env` grants are withheld exactly as in a staged run, so the bundle is the only way out.
- A `map` child's nodes may declare `outputs` when the map uses `on_item_fail: collect`. A child does not write: its requests go up to the map, which checks and applies them after every item ran, item by item in input order, each item under its own caps (`<map>[<key>]`), so ten items with `max: 1` make at most ten writes. `{ input: name }` pins resolve against the child's input (`item_key`, `with:` values). In approval mode the whole map visit is one bundle. Child writes get no model screen: with `safe_outputs.screen` on they are vetoed.
- Who decides a node's access is covered in [Permissions and defaults](#permissions-and-defaults).

Full field reference: [spec.sweny.ai/nodes/#safe-outputs](https://spec.sweny.ai/nodes/#safe-outputs).

### Permissions and defaults

A node's access is the first of these that applies:

1. the node's own `permissions` (`read` or `write`, or `access` in the object form)
2. `read`, when the node declares `outputs`
3. the workflow's `permissions`
4. the default for the file's `spec_version`

| `spec_version`  | Default for a node that declares nothing | What happens on load                                                                                     |
| --------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `"3"`           | `read`                                   | Nothing extra.                                                                                           |
| `"2"`           | `read`                                   | Nothing extra: it runs exactly as written (version 3 only adds [map nodes](https://spec.sweny.ai/map/)). |
| `"1"` or absent | `write`                                  | Still `write`, plus one warning per such node: it can write because nothing limits it. |

A workflow `permissions: read` is a ceiling: no node under it can write. A `read` node gets read tools only, no external skill MCP servers, and no shell, file-write, edit, fetch or subagent built-ins.

To move a `"1"` file to the current version, run `sweny workflow upgrade <file>`. It sets `spec_version: "3"` and writes `permissions: write` on each node that was relying on the old default, with a comment saying why, so the file runs exactly as before. It never grants more than the node had. The one exception is a node with no skills and `native: none`: it has no tools, so it gets `read`. Then narrow each node: `read` if it only reads, `outputs` if it only posts.

Every workflow `sweny new` writes is `spec_version: "2"`. Each node is `read` unless its job needs a write, and GitHub writes are safe outputs.

A `pr-review` workflow written by `sweny new` before this change tells its last node to approve the pull request, and `sweny workflow upgrade` keeps that line. sweny warns on load when a node that can write is told to approve in a review workflow. Regenerate it with `sweny new --template pr-review`, or delete the line and post the review as a `comment` output.

### Instructions

The `instruction` field is the core of each node. Write it as you would write a prompt for a coding agent -- clear, specific, and focused on a single task. The agent receives the instruction along with the workflow input and all prior node results as context.

Good instructions:

- Focus on one task per node
- List explicit steps (numbered or bulleted)
- Specify what tools to use and what to look for
- State what output is expected

### Skills

The `skills` array lists skill IDs that should be available at this node. Each skill provides a set of tools that the agent can call.

Available skill IDs:

| Skill ID       | Category      | Tools provided                                                   |
| -------------- | ------------- | ---------------------------------------------------------------- |
| `github`       | git           | Repository operations, PRs, issues, file read/write, code search |
| `linear`       | tasks         | Issue CRUD, project/team queries, comments                       |
| `sentry`       | observability | Error search, issue details, event data, releases                |
| `datadog`      | observability | Log search, metric queries, monitor status                       |
| `betterstack`  | observability | Incident list, log search                                        |
| `slack`        | notification  | Send messages, search channels                                   |
| `notification` | notification  | Discord, Teams, webhook, and email notifications                 |

:::note[Skill availability at runtime]
A node can list skills that may not be configured. At execution time, the executor only loads skills that have valid credentials. This lets the same workflow work across different environments without modification.
:::

### Output schema

The `output` field accepts a JSON Schema object. When present, the agent's response is validated against this schema, and the resulting structured data is available to downstream nodes and routing conditions.

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

SWEny validates the output against the whole schema, at every depth, the same way on every harness: nested objects, arrays of objects, `enum`, `required` at any depth, `additionalProperties: false`. The dialect is JSON Schema 2020-12 unless `$schema` names draft-04, draft-06, draft-07 or 2019-09; `format` is not asserted. When the output breaks the schema, the agent is asked once to fix it, with each problem named by its path. If it is still broken, the node fails with an error like:

```
output schema violation: findings[1].title: required but missing; findings[1].severity: expected one of ["low","medium","high"]
```

Errors name the path and the rule, never the value the agent emitted. With `retry` configured, that failure takes the normal retry path. A problem under a field a `when` expression reads does not fail the node; the routes that read it fall through to the next rung. Output nested deeper than 64 levels, or holding more than 100,000 values, is not checked and fails the node.

A schema the validator cannot compile (for example array-form `items` with no draft-07 `$schema`, or a property-level `required: true`) still loads, with an `OUTPUT_SCHEMA_FALLBACK` warning, and gets only the earlier top-level check. This is deprecated: a future minor will refuse to load it.

## Edge definition

Each entry in the `edges` array is an edge object:

| Field  | Type   | Required | Description                                                             |
| ------ | ------ | -------- | ----------------------------------------------------------------------- |
| `from` | string | Yes      | Source node ID.                                                         |
| `to`   | string | Yes      | Target node ID.                                                         |
| `when` | string | No       | Natural language condition. The coding agent evaluates this at runtime. |

### Unconditional edges

An edge without a `when` clause is unconditional -- the executor always follows it. Use these for linear sequences:

```yaml
edges:
  - from: gather
    to: analyze
  - from: analyze
    to: report
```

If a node has exactly one outgoing edge and that edge is unconditional, the executor follows it without asking the agent for a routing decision.

### Conditional edges

An edge with a `when` clause is conditional. The `when` value is natural language that the coding agent evaluates against the current node's result:

```yaml
edges:
  - from: analyze
    to: fix
    when: "The issue is fixable with a simple code change"
  - from: analyze
    to: escalate
    when: "The issue requires infrastructure changes or human review"
```

When a node has multiple outgoing conditional edges, the executor presents all conditions as choices and asks the coding agent to pick the one that matches. If one edge is unconditional among conditional siblings, it acts as the default/fallback path.

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

| Rule                      | Error code                 | Description                                                                                                                                     |
| ------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry exists              | `MISSING_ENTRY`            | The `entry` value must match a key in `nodes`.                                                                                                  |
| Valid edge sources        | `UNKNOWN_EDGE_SOURCE`      | Every edge `from` must reference an existing node ID.                                                                                           |
| Valid edge targets        | `UNKNOWN_EDGE_TARGET`      | Every edge `to` must reference an existing node ID.                                                                                             |
| Bounded self-loops        | `SELF_LOOP`                | An edge where `from` equals `to` must declare `max_iterations`. Bounded self-loops are allowed — only unbounded ones are rejected.              |
| All nodes reachable       | `UNREACHABLE_NODE`         | Every node must be reachable from the entry node via BFS traversal.                                                                             |
| No unbounded cycles       | `UNBOUNDED_CYCLE`          | Any cycle must have at least one edge with `max_iterations`. The detector removes bounded edges, then checks the remaining subgraph for cycles. |
| Edge iteration ceiling    | `EDGE_ITERATIONS_EXCEEDED` | `max_iterations` may not exceed 100.                                                                                                            |
| Retry ceiling             | `RETRY_MAX_EXCEEDED`       | `retry.max` may not exceed 10.                                                                                                                  |
| Unique evaluator names | `DUPLICATE_EVALUATOR` | Evaluator `name`s must be unique within a node. |
| Known skills              | `UNKNOWN_SKILL`            | If a skill catalog is provided, all referenced skill IDs must exist in it.                                                                      |
| Valid inline skills       | `INVALID_INLINE_SKILL`     | Inline `skills` entries in a workflow must declare `instruction`, `mcp`, or both.                                                               |
| Budget ceiling            | `BUDGET_CEILING`           | A node's `budget.tokens` or `budget.cost_usd` may not exceed the workflow's.                                                                    |
| Permission ceiling        | `PERMISSION_CEILING`       | A node may not declare `permissions: write` when the workflow declares `read`.                                                                  |
| No secrets on read nodes  | `AGENT_ENV_READ_ONLY`      | A node whose permissions resolve to `read` may not declare `agent_env`.                                                                         |
| Allowed outputs           | `OUTPUT_NOT_ALLOWED`       | A node's output type must be in `safe_outputs.allow` when that is set.                                                                          |
| One entry per output type | `DUPLICATE_OUTPUT`         | A node may declare each output type once.                                                                                                       |
| Supported output skill    | `UNSUPPORTED_OUTPUT`       | An output's `via` must name a skill that can apply it (`github`: all types; `linear`: `comment`, `issue`).                                      |

All checks run in one pass and every problem is reported together. The same validation runs inside `execute()`, so a workflow passed straight to the library (or Studio's simulator) is rejected before any node runs.

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

| Command                                      | Description                                                       |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `sweny workflow validate <file>`             | Validate a workflow YAML/JSON file. Exit 0 if valid, 1 if errors. |
| `sweny workflow run <file>`                  | Execute a workflow file.                                          |
| `sweny workflow run <file> --dry-run`        | Validate and show structure without running.                      |
| `sweny workflow run <file> --stage`          | Run normally, but print each safe output instead of writing it.   |
| `sweny workflow run <file> --json`           | Output results as JSON on stdout.                                 |
| `sweny workflow export triage`               | Print the built-in triage workflow as YAML.                       |
| `sweny workflow export implement`            | Print the built-in implement workflow as YAML.                    |
| `sweny workflow create <description>`        | Deprecated: use `sweny new` and pick "Describe your own".         |
| `sweny workflow create <description> --json` | Deprecated: generate and output as JSON (non-interactive).        |
| `sweny workflow edit <file> [instruction]`   | Edit a workflow file with natural-language instructions.          |
| `sweny workflow list`                        | List all available skills.                                        |
| `sweny workflow list --json`                 | List skills as JSON array.                                        |
