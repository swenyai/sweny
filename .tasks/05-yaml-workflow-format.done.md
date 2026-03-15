# Task 05: YAML Workflow Format — `sweny workflow run <file>`

## Context

`WorkflowDefinition` is already fully serializable JSON. `StepDefinition.uses` already exists.
What's missing: a way to run a workflow from a YAML/JSON file without writing TypeScript.

**Goal:**
```bash
sweny workflow run ./my-triage.yaml
sweny workflow run ./my-workflow.json
```

The workflow file is declarative. Steps reference built-in step implementations by type name.
Users can fork any built-in workflow, save it as YAML, modify it, and run it.

---

## Built-in Step Registry

Before the CLI command can resolve step types, the engine needs a registry of built-in step implementations.

### `packages/engine/src/registry.ts` (new file or extend existing)

```ts
import type { StepImplementations, WorkflowDefinition } from "./types.js";

/**
 * A named, versioned step implementation that can be referenced
 * in a WorkflowDefinition via StepDefinition.uses.
 */
export interface StepType {
  /** The type identifier used in YAML, e.g. "sweny/fetch-issue" */
  type: string;
  /** Human-readable description shown in Studio and CLI help */
  description: string;
  /** The implementation factory */
  impl: <TConfig>(ctx: import("./types.js").WorkflowContext<TConfig>) => Promise<import("./types.js").StepResult>;
}

/** Global registry of built-in step types */
export const builtinStepRegistry: Map<string, StepType> = new Map();

export function registerStepType(entry: StepType): void {
  builtinStepRegistry.set(entry.type, entry);
}
```

### Register built-in steps

In each step file (e.g. `packages/engine/src/recipes/triage/steps/fetch-issue.ts`), call `registerStepType` at module load:

```ts
registerStepType({
  type: "sweny/fetch-issue",
  description: "Fetch the issue details from the configured issue tracker",
  impl: fetchIssueStep,
});
```

Built-in types to register:
| Type | File |
|------|------|
| `sweny/verify-access` | `triage/steps/verify-access.ts` |
| `sweny/build-context` | `triage/steps/build-context.ts` |
| `sweny/investigate` | `triage/steps/investigate.ts` |
| `sweny/novelty-gate` | `triage/steps/novelty-gate.ts` |
| `sweny/create-issue` | `triage/steps/create-issue.ts` |
| `sweny/cross-repo-check` | `triage/steps/cross-repo-check.ts` |
| `sweny/implement-fix` | `triage/steps/implement-fix.ts` |
| `sweny/create-pr` | `triage/steps/create-pr.ts` |
| `sweny/notify` | `triage/steps/notify.ts` |
| `sweny/dedup-check` | `triage/steps/dedup-check.ts` |
| `sweny/fetch-issue` | `implement/steps/fetch-issue.ts` |

### `resolveWorkflow(definition)` — new engine export

```ts
/**
 * Resolve a WorkflowDefinition into a runnable Workflow by looking up
 * each step's `uses` field in the built-in registry.
 *
 * Steps without `uses` (or with unrecognized types) will throw.
 * For custom implementations, use createWorkflow() directly.
 */
export function resolveWorkflow<TConfig>(
  definition: WorkflowDefinition,
): Workflow<TConfig> {
  const implementations: StepImplementations<TConfig> = {};
  for (const [stepId, step] of Object.entries(definition.steps)) {
    if (!step.type) {
      throw new Error(`Step "${stepId}" has no type — set step.type to a built-in type (e.g. "sweny/fetch-issue") or use createWorkflow() with custom implementations`);
    }
    const entry = builtinStepRegistry.get(step.type);
    if (!entry) {
      throw new Error(`Unknown step type "${step.type}" in step "${stepId}". Available types: ${[...builtinStepRegistry.keys()].join(", ")}`);
    }
    implementations[stepId] = entry.impl;
  }
  return createWorkflow(definition, implementations);
}
```

Note: `StepDefinition` needs a `type?: string` field added (distinct from `uses` which is for provider roles). See below.

### Add `type` field to `StepDefinition`

In `packages/engine/src/types.ts`, add to `StepDefinition`:

```ts
/**
 * Built-in step type identifier (e.g. "sweny/fetch-issue").
 * When set, resolveWorkflow() looks this up in the built-in step registry.
 * Not needed when using createWorkflow() with explicit implementations.
 */
type?: string;
```

Export `resolveWorkflow` from `packages/engine/src/index.ts`.

---

## YAML Workflow File Format

```yaml
id: my-triage
version: 1.0.0
name: My Custom Triage
description: Triage incidents from Datadog, create Linear issues
initial: verify-access

steps:
  verify-access:
    type: sweny/verify-access
    phase: learn
    critical: true
    next: build-context

  build-context:
    type: sweny/build-context
    phase: learn
    uses: [observability]
    critical: true
    next: investigate

  investigate:
    type: sweny/investigate
    phase: learn
    uses: [codingAgent]
    critical: true
    next: novelty-gate

  novelty-gate:
    type: sweny/novelty-gate
    phase: act
    uses: [issueTracker]
    on:
      skip: notify
      implement: create-issue
      failed: notify

  create-issue:
    type: sweny/create-issue
    phase: act
    uses: [issueTracker]
    next: notify
    on:
      failed: notify

  notify:
    type: sweny/notify
    phase: report
    uses: [notification]
```

---

## CLI Command

### `packages/cli/src/main.ts`

Add a `workflow` subcommand with `run` subcommand:

```ts
const workflowCmd = program.command("workflow").description("Manage and run workflow files");

workflowCmd
  .command("run <file>")
  .description("Run a workflow from a YAML or JSON file")
  .option("--agent <provider>", "Coding agent: claude (default), codex, gemini", "claude")
  .option("--dry-run", "Validate workflow without running")
  .action(async (file: string, options: Record<string, unknown>) => {
    // 1. Read file (YAML or JSON based on extension)
    // 2. Parse → WorkflowDefinition
    // 3. Validate
    // 4. resolveWorkflow(definition)
    // 5. createProviders(config, logger) — same as triage/implement
    // 6. runWorkflow(workflow, config, providers, { logger, observer })
    // 7. Print result
  });
```

### YAML parsing

Add `yaml` as a dependency in `packages/cli/package.json`:
```json
"dependencies": {
  "yaml": "^2.0.0"
}
```

Parse logic:
```ts
import { parse as parseYaml } from "yaml";
import * as fs from "node:fs";
import * as path from "node:path";

function loadWorkflowFile(filePath: string): WorkflowDefinition {
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();
  const raw = ext === ".yaml" || ext === ".yml" ? parseYaml(content) : JSON.parse(content);
  // Validate shape
  const errors = validateWorkflow(raw);
  if (errors.length > 0) {
    throw new Error(`Invalid workflow file:\n${errors.map(e => `  ${e.message}`).join("\n")}`);
  }
  return raw as WorkflowDefinition;
}
```

---

## Export built-in workflow definitions as YAML

Add `sweny workflow export triage` and `sweny workflow export implement` commands that print the YAML representation of the built-in workflows to stdout. Users can then fork them:

```bash
sweny workflow export triage > my-triage.yaml
# edit my-triage.yaml
sweny workflow run my-triage.yaml
```

Implementation: serialize `triageDefinition` / `implementDefinition` using the `yaml` package.

---

## Tests

`packages/cli/tests/workflow-run.test.ts` (new):
- Loads a valid YAML file and runs it with mock providers
- Errors clearly on unknown step type
- Errors clearly on invalid YAML structure
- `--dry-run` validates without running

`packages/engine/src/resolve-workflow.test.ts` (new):
- `resolveWorkflow` wires up implementations from registry
- Throws clear error for unknown step type
- Throws clear error for step with no type field

---

## Changeset

`.changeset/yaml-workflow-format.md`:
```md
---
"@sweny-ai/engine": minor
"@sweny-ai/cli": minor
---

Add declarative YAML workflow support.

- New `StepDefinition.type` field for referencing built-in step implementations
- New `resolveWorkflow(definition)` — resolves a WorkflowDefinition to a runnable Workflow using the built-in step registry
- New CLI command: `sweny workflow run <file.yaml>` — run any workflow from a YAML/JSON file
- New CLI command: `sweny workflow export triage|implement` — print built-in workflow as YAML for forking
```

---

## Done Criteria

- [ ] `resolveWorkflow()` exported from `@sweny-ai/engine`
- [ ] `StepDefinition.type` field added
- [ ] Built-in step types registered (`sweny/verify-access`, `sweny/build-context`, etc.)
- [ ] `sweny workflow run ./my-workflow.yaml` works end-to-end
- [ ] `sweny workflow export triage` prints valid YAML
- [ ] `npm test` passes in `packages/engine`, `packages/cli`
- [ ] Changeset created
