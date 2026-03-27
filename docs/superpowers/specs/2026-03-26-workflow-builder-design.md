# Workflow Builder — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Goal:** Let users create and edit SWEny workflows from natural language descriptions via the CLI, and fix the DagRenderer UX.

## Context

SWEny has a well-defined `Workflow` type (nodes, edges, entry) validated by Zod schemas. Currently, workflows are hand-coded in TypeScript. Users should be able to describe what they want in plain English and get a valid, runnable workflow YAML file — using the same Claude backend that powers execution.

The existing `DagRenderer` (terminal DAG visualization) works but produces visually awkward output — inconsistent box widths, uncentered arrows, and a lack of visual polish. This needs fixing before it's used to preview generated workflows.

## Architecture

### `buildWorkflow()` — Core Function

```
packages/core/src/workflow-builder.ts
```

Single-shot generation: Claude receives the user's description plus the list of available skills, generates a complete `Workflow` object, and the function validates it with `workflowZ.parse()` + `validateWorkflow()`.

```ts
export interface BuildWorkflowOptions {
  claude: Claude;
  skills: Skill[];
  logger?: Logger;
}

export async function buildWorkflow(
  description: string,
  options: BuildWorkflowOptions,
): Promise<Workflow>
```

**How it works:**

1. Build a system prompt containing:
   - The `Workflow` JSON schema (from `workflowJsonSchema`)
   - Available skill IDs with descriptions (from `options.skills`)
   - Instruction quality guidance (see below)
   - Rules: use `snake_case` for node IDs, set `entry` to the first node, reference only provided skills
2. Call `claude.run()` with the user's description as the instruction and an `outputSchema` matching the workflow shape
3. Parse the response with `workflowZ.parse()`
4. Run `validateWorkflow()` for structural checks
5. Return the validated `Workflow`

If Claude returns invalid output, throw with the validation errors. No automatic retry — the CLI handles refinement interactively.

### Instruction quality guidance

Node instructions are the core value of a workflow — they determine what Claude actually does at each step. The system prompt must include explicit guidance to produce detailed, actionable instructions rather than shallow one-liners:

```
Each node's `instruction` field is a detailed prompt that Claude will execute autonomously.
Write instructions as if briefing a skilled engineer who has access to the node's tools
but no other context. Be specific about:

- WHAT to query/search/create (not just "check for errors" — specify filters, time ranges, grouping)
- HOW to interpret results (what counts as actionable? what thresholds matter?)
- WHAT output to produce (structured findings, not just "summarize")
- HOW to handle edge cases (no results found, too many results, ambiguous data)

Bad:  "Query Sentry for errors"
Good: "Query Sentry for unresolved errors from the last 24 hours. Group by issue
       fingerprint. For each group, note: error count, affected services, first/last
       seen timestamps, and stack trace summary. Prioritize by frequency × recency.
       If no errors found, report that explicitly so downstream nodes can skip."
```

### `refineWorkflow()` — Edit Function

Same file. Takes an existing workflow + edit instruction, returns a new workflow.

```ts
export async function refineWorkflow(
  workflow: Workflow,
  instruction: string,
  options: BuildWorkflowOptions,
): Promise<Workflow>
```

Same flow as `buildWorkflow()` but the system prompt includes the current workflow as context. Claude modifies it according to the instruction.

## CLI Commands

### `sweny workflow create <description>`

```
sweny workflow create "monitor sentry for new errors, investigate with datadog, create linear tickets for real bugs, notify slack"
```

Flow:
1. Call `buildWorkflow(description, { claude, skills })`
2. Render the workflow with `DagRenderer` (static, no animation)
3. Prompt: `Save to [workflow.id].yml? (Y/n/refine) >`
   - **Y** (default): write YAML to `./[workflow.id].yml`, print path
   - **n**: exit without saving
   - **refine**: prompt for refinement text, call `refineWorkflow()`, re-render, re-prompt
4. Refinement loop repeats until user accepts or cancels

### `sweny workflow edit <file> [instruction]`

```
sweny workflow edit my-workflow.yml "add a notification step after the PR is created"
sweny workflow edit my-workflow.yml   # opens interactive refinement
```

Flow:
1. Load and parse the workflow file
2. If `instruction` provided: call `refineWorkflow(workflow, instruction, { claude, skills })`
3. If no instruction: prompt for edit description interactively
4. Render the updated workflow with `DagRenderer`
5. Prompt: `Save changes? (Y/n/refine) >`
   - **Y**: overwrite the file with updated YAML
   - **n**: exit without saving
   - **refine**: prompt for another edit, loop

### Input handling

Both commands use Node's `readline` for the interactive prompt. The `--json` flag suppresses interactive prompts and writes the workflow JSON to stdout (for piping/scripting).

## DagRenderer UX Fix

The renderer uses vertical layout (top to bottom), which is correct. Three changes:

### Fix 1: Uniform box widths

Compute the max node name width across all nodes, use it for every box. The current renderer sizes each box to its own content, producing ragged edges.

### Fix 2: Branching support

When a node has multiple outgoing edges, render targets side-by-side with a fork connector (`┌───┴───┐`). The current renderer flattens everything into a linear vertical list regardless of graph structure.

### Fix 3: Clean connectors

Use `▼` arrowheads on downward connectors. Use `┌───┴───┐` for forks and `│` for straight vertical lines.

### Target output

```
  ┌──────────────────────┐
  │ ● gather_errors      │
  └──────────┬───────────┘
             │
  ┌──────────▼───────────┐
  │ ◉ investigate        │
  └──────────┬───────────┘
             │
     ┌───────┴───────┐
     │               │
  ┌──▼───────────┐ ┌─▼──────────────┐
  │ ○ create     │ │ ○ skip         │
  │   ticket     │ │                │
  └──────┬───────┘ └────────────────┘
         │
  ┌──────▼───────────────┐
  │ ○ notify             │
  └──────────────────────┘

  ● completed   ◉ running   ○ pending   ✕ failed
```

When the terminal is too narrow for side-by-side branches, fall back to the current sequential layout.

## YAML Output Format

Generated workflows serialize using the `yaml` package with `indent: 2, lineWidth: 120`. Example:

```yaml
id: monitor-triage
name: Monitor & Triage
description: Monitor Sentry for errors, investigate with Datadog, create Linear tickets, notify Slack
entry: gather_errors
nodes:
  gather_errors:
    name: Gather Errors
    instruction: >-
      Query Sentry for unresolved errors in the last 24 hours.
      Group by issue fingerprint and sort by frequency.
    skills:
      - sentry
  investigate:
    name: Investigate
    instruction: >-
      For each error group, check Datadog APM for correlated latency
      spikes or elevated error rates in the affected service.
    skills:
      - datadog
  create_ticket:
    name: Create Ticket
    instruction: >-
      Create a Linear issue for confirmed bugs with error details,
      investigation findings, and suggested severity.
    skills:
      - linear
  notify:
    name: Notify
    instruction: >-
      Post a summary to Slack with the created tickets and key findings.
    skills:
      - slack
edges:
  - from: gather_errors
    to: investigate
  - from: investigate
    to: create_ticket
    when: Real bugs found that need tickets
  - from: investigate
    to: notify
    when: No actionable bugs found
  - from: create_ticket
    to: notify
```

## Scope Boundaries

**In scope:**
- `buildWorkflow()` and `refineWorkflow()` in `packages/core/src/workflow-builder.ts`
- `sweny workflow create <description>` CLI command
- `sweny workflow edit <file> [instruction]` CLI command
- DagRenderer UX fix (uniform box widths, branching layout, clean connectors)
- Tests for buildWorkflow, refineWorkflow, and updated DagRenderer

**Out of scope:**
- Studio integration (Studio already has its own editor)
- Workflow marketplace/sharing
- Multi-file workflow composition
- Custom skill creation via CLI
