# Task: Write Workflows Section (5 pages)

## Goal
Write the 5 Workflows pages. This is the core of SWEny's value — DAG-based orchestration.

## Pages to write

All pages go in `packages/web/src/content/docs/workflows/`.

### 1. `index.md` — How Workflows Work
- A Workflow is a DAG: nodes connected by edges, with an entry point
- Execution model step-by-step:
  1. Start at entry node
  2. Claude receives: instruction + context (input + all prior results) + tools from node's skills
  3. Claude executes instruction, calling tools as needed
  4. Returns NodeResult (status: success/skipped/failed, data, toolCalls)
  5. Executor evaluates outgoing edge conditions (Claude picks which edge to follow)
  6. Moves to next node; repeat until terminal node (no outgoing edges)
- Execution events emitted: workflow:start, node:enter, tool:call, tool:result, node:exit, route, workflow:end
- Observer pattern: pass an observer function to get real-time events (used by CLI DAG renderer and Studio live mode)
- Conditional routing: edges with `when` clauses are natural language — Claude evaluates them against the current node's result
- Unconditional edges: if no `when`, the edge is always taken
- Validation: SWEny validates workflows before execution (entry exists, no cycles, all nodes reachable, referenced skills exist)

### 2. `triage.md` — Triage Workflow
- The built-in triage workflow: investigate a production alert → gather context → determine root cause → create issue → notify team
- Show the actual workflow definition from `packages/core/src/workflows/triage.ts`:
  - 5 nodes: gather, investigate, create_issue, notify, skip
  - Entry: gather
  - Edges: gather→investigate (always), investigate→create_issue (when novel + medium+ severity), investigate→skip (when duplicate or low), create_issue→notify (always)
- Node details table: node ID, name, skills, has output schema?
- The `investigate` node has a structured output schema (root_cause, severity, affected_services, is_duplicate, recommendation, fix_approach)
- Explain the conditional routing: Claude evaluates severity and novelty to decide whether to create an issue or skip

### 3. `implement.md` — Implement Workflow
- The built-in implement workflow: analyze issue → implement fix → open PR → notify
- Show the actual definition from `packages/core/src/workflows/implement.ts`:
  - 5 nodes: analyze, implement, create_pr, notify, skip
  - Entry: analyze
  - Edges: analyze→implement (when low/medium risk + clear plan), analyze→skip (when too complex/risky), implement→create_pr, create_pr→notify
- The `analyze` node has structured output (issue_summary, files_to_change, fix_plan, risk_level)
- This workflow uses Claude Code's full coding capabilities via the github skill

### 4. `custom.md` — Custom Workflows
- How to write a custom workflow as YAML
- Start with a simple 2-node example:
  ```yaml
  id: hello
  name: Hello World
  description: A simple test workflow
  entry: greet
  nodes:
    greet:
      name: Greet
      instruction: "Say hello and gather some basic info about the repository."
      skills: [github]
    summarize:
      name: Summarize
      instruction: "Summarize what was learned in the greet step."
      skills: []
  edges:
    - from: greet
      to: summarize
  ```
- Adding conditional edges:
  ```yaml
  edges:
    - from: analyze
      to: fix
      when: "The issue is fixable with a simple code change"
    - from: analyze
      to: escalate
      when: "The issue requires infrastructure changes or human review"
  ```
- Adding structured output schemas to nodes
- Running custom workflows: `sweny workflow run my-workflow.yml` or `sweny workflow validate my-workflow.yml`
- Creating workflows with AI: `sweny workflow create "investigate slow API endpoints and create optimization tickets"`
- Editing workflows with AI: `sweny workflow edit my-workflow.yml "add a notification step at the end"`
- Using Studio to build visually then export as YAML

### 5. `yaml-reference.md` — YAML Reference
- Full schema for workflow YAML files:
  - `id` (string, required): unique identifier
  - `name` (string, required): human-readable name
  - `description` (string, required): what this workflow does
  - `entry` (string, required): ID of the entry node
  - `nodes` (object, required): map of node ID → node definition
    - `name` (string, required): display name
    - `instruction` (string, required): what Claude should do (natural language)
    - `skills` (string[], required): skill IDs available at this node
    - `output` (object, optional): JSON Schema for structured output
  - `edges` (array, required): array of edge objects
    - `from` (string, required): source node ID
    - `to` (string, required): target node ID
    - `when` (string, optional): natural language condition
- Validation rules:
  - Entry node must exist in nodes
  - All edge `from`/`to` must reference existing nodes
  - No self-loops
  - No cycles
  - All nodes must be reachable from entry
  - Non-terminal nodes must have at least one outgoing edge
  - Referenced skills should exist in the skill catalog
- Available skill IDs: github, linear, sentry, datadog, betterstack, slack, notification

## Source of truth
- `packages/core/src/types.ts` — Workflow, Node, Edge interfaces
- `packages/core/src/schema.ts` — Zod schemas + validation rules
- `packages/core/src/workflows/triage.ts` — triage definition
- `packages/core/src/workflows/implement.ts` — implement definition
- `packages/core/src/executor.ts` — execution model
- `packages/core/src/cli/main.ts` — workflow subcommands (create, edit, run, validate, export)
