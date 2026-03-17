# Task 21 — Studio: simulate mode for custom workflows

## Goal

Simulate mode currently runs the workflow using the built-in mock providers
(which only handle triage/implement steps). When a user designs a custom
workflow with non-built-in step types (e.g., a custom `my-org/deploy` step),
clicking Simulate shows nothing useful or errors out.

This task makes Simulate mode work for custom workflows by running each step
through a **stub runner** that marks every step as "success" (or lets the user
choose the outcome) when no real implementation is registered.

## Context

- **`packages/studio/src/components/SimulationPanel.tsx`** — the Simulate panel
  has a "Run" button that fires `runWorkflow()` with the current definition and
  browser-safe providers. Read this file carefully before making changes.
- **`packages/engine/src/browser-runner.ts`** — the browser-safe runner. When
  a step type is not recognized, `resolveWorkflow()` throws. For simulation,
  we want to fall back to a stub implementation.
- **`packages/studio/src/store/editor-store.ts`** — `applyEvent()` feeds step
  results into the UI (colors, execution result card in PropertiesPanel).

## What to implement

### Stub step implementation

Create a utility in `packages/studio/src/lib/simulate-runner.ts`:

```typescript
import { createWorkflow } from "@sweny-ai/engine";
import type { WorkflowDefinition, StepResult } from "@sweny-ai/engine";

/** Build a createWorkflow-compatible impl map that stubs every step as success. */
export function buildStubImplementations(
  definition: WorkflowDefinition,
): Record<string, () => Promise<StepResult>> {
  return Object.fromEntries(
    Object.keys(definition.steps).map((id) => [
      id,
      async (): Promise<StepResult> => ({ status: "success" }),
    ]),
  );
}
```

### SimulationPanel integration

In `SimulationPanel.tsx`, when calling `createWorkflow()`:
1. Try to resolve normally (using registered step types for built-in steps)
2. If that fails, fall back to `buildStubImplementations(definition)`

This lets built-in steps run with real logic (if registered) while custom steps
get stub implementations that always succeed.

Add a visible indicator: "Custom steps will run as stubs (always success)."

### Outcome override (stretch goal)

After the basic stub runner works, allow the user to override what outcome
a step returns. A "Step outcomes" section in SimulationPanel could let the
user set `data.outcome = "failed"` for a specific step to test a failure path.

Focus on the basic stub runner first — outcome override is optional.

## Changeset

```md
---
"@sweny-ai/studio": minor
---
Simulate mode now works for custom workflows. Steps without a registered
implementation run as stubs (always success), so you can visualize execution
flow for any workflow definition.
```

## Done when

- [ ] `buildStubImplementations()` in `simulate-runner.ts`
- [ ] SimulationPanel falls back to stubs when `resolveWorkflow()` fails
- [ ] Indicator shown when stubs are in use
- [ ] Changeset created
- [ ] `npx tsc --noEmit` passes in packages/studio
