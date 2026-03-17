# Task 30 — Docs: fix stale terminology in studio docs

## Goal

`packages/web/src/content/docs/studio/index.md` and `studio/recipe-authoring.md`
use the old pre-rename API names throughout. Every code example is broken for new
users who try to copy-paste them.

## Files to update

### 1. `packages/web/src/content/docs/studio/index.md`

**Rename component + types throughout:**
- `RecipeViewer` → `WorkflowViewer` (the actual export from `@sweny-ai/studio/viewer`)
- `RecipeDefinition` → `WorkflowDefinition`
- "recipe" → "workflow" (when describing the graph/definition)
- "states" → "steps" (when describing graph nodes)
- "state" → "step" (singular)

**Specific line fixes:**
- Title description frontmatter: "recipes" → "workflows"
- Line 6: "any `RecipeDefinition`" → "any `WorkflowDefinition`"
- Line 8: "the built-in recipes" → "the built-in workflows"
- Line 14: "Edit the recipe graph directly" → "Edit the workflow graph directly"
- Line 16: "Add states" → "Add steps"
- Line 20: "any JSON `RecipeDefinition`" → "any JSON `WorkflowDefinition`"; "createRecipe()" → "createWorkflow()"
- Line 24: "Run the recipe in the browser" → "Run the workflow in the browser"; "States highlight" → "Steps highlight"
- Line 28: "monitoring long-running recipes" → "monitoring long-running workflows"
- Line 32: "routing rules exist on a state" → "routing rules exist on a step"
- Line 42: "any valid JSON `RecipeDefinition`" → "any valid JSON `WorkflowDefinition`"
- Line 44: "your recipe config" → "your workflow config"
- Line 46: "generates a `createRecipe()` call" → "generates a `createWorkflow()` call"
- Line 50: "`RecipeDefinition` into the URL" → "`WorkflowDefinition` into the URL"; "the same graph" → "the same workflow"
- Line 57: "Missing `initial` state" → "Missing `initial` step"
- Line 58: "`initial` references a state" → "`initial` references a step"
- Line 63: "`RecipeViewer` component" → "`WorkflowViewer` component"
- Lines 66-73: update the code example (see below)
- Line 85: `addState` → no longer a valid store method; update to describe `useEditorStore` more generally
- Line 88: "Recipe Authoring" → "Workflow Authoring"

**Updated embed code example (lines 63-76):**
```ts
import { WorkflowViewer } from "@sweny-ai/studio/viewer";
import "@sweny-ai/studio/style.css";

<WorkflowViewer
  definition={myDefinition}
  executionState={{ "verify-access": "success", "fetch-issue": "current" }}
  height={480}
/>
```

**Add unreachable step visual callout** (in the Validation overlay section, after the bullet list):
```
Unreachable steps are highlighted with a dashed orange border and a ⚠ badge.
Clicking a validation error in the banner selects the affected step.
```

### 2. `packages/web/src/content/docs/studio/recipe-authoring.md`

This page needs a near-complete rewrite. The actual engine API is:
- `WorkflowDefinition` (NOT `RecipeDefinition`) — has `name`, `initial`, `steps` (no `id`, no `version`)
- `StepDefinition` (NOT `StateDefinition`) — has `phase`, `transitions?` array, `type?`
- `createWorkflow<C>(definition, implementations)` (NOT `createRecipe`)
- `runWorkflow(workflow, config, registry, { logger?, observer? })` (NOT `runRecipe`)
- `validateWorkflow(definition)` returns `WorkflowDefinitionError[]` (NOT `validateDefinition`)
- Event types: `workflow:start`, `step:enter`, `step:exit`, `workflow:end` (NOT `recipe:start`, `state:enter` etc.)
- `RunObserver` interface with `onEvent(event: ExecutionEvent): void | Promise<void>`
- Transitions use `transitions: [{ on: string; target: string }]` array syntax (NOT `on: Record<string, string>`, NOT `next:`)

**Actual `WorkflowDefinition` shape (from `packages/engine/src/types.ts`):**
```ts
interface WorkflowDefinition {
  name: string;
  initial: string;
  steps: Record<string, StepDefinition>;
}
```

**Actual `StepDefinition` shape:**
```ts
interface StepDefinition {
  phase: "learn" | "act" | "report";
  description?: string;
  critical?: boolean;
  type?: string;           // built-in step type (e.g. "sweny/investigate")
  timeout?: number;        // ms
  transitions?: Array<{ on: string; target: string }>;
}
```

**Transitions** — array syntax, NOT the old `on: {}` / `next:` object syntax:
```yaml
transitions:
  - on: done
    target: next-step
  - on: failed
    target: error-step
```
Or in TypeScript:
```ts
transitions: [
  { on: "done",   target: "next-step" },
  { on: "failed", target: "error-step" },
]
```

**`createWorkflow` and `runWorkflow`:**
```ts
import { createWorkflow, runWorkflow, createProviderRegistry } from "@sweny-ai/engine";

const myWorkflow = createWorkflow<MyConfig>(myDefinition, {
  "verify-setup": verifySetup,
  "do-work":      doWork,
  "notify":       sendNotification,
});

const result = await runWorkflow(myWorkflow, config, registry, { logger, observer });
console.log(result.status); // "success" | "failed" | "partial"
console.log(result.steps);  // per-step results
```

**Observer:**
```ts
import type { RunObserver } from "@sweny-ai/engine";

const observer: RunObserver = {
  onEvent(event) {
    switch (event.type) {
      case "workflow:start": ...
      case "step:enter":     ...
      case "step:exit":      ...
      case "workflow:end":   ...
    }
  }
};
```

**`validateWorkflow`:**
```ts
import { validateWorkflow } from "@sweny-ai/engine";

const errors = validateWorkflow(myDefinition);
// errors: WorkflowDefinitionError[] — each has { code, message, stateId? }
```

**Update the page title/frontmatter:**
- title: "Workflow Authoring"
- description: update to use "workflow" and "step" terminology

**Update all inline references:**
- "recipe" → "workflow"
- "state" → "step"
- The step function still receives `WorkflowContext<C>` — this is correct already
- `ctx.results.get("step-id")` — correct, no change

## Done when

- [ ] No occurrence of `RecipeViewer`, `RecipeDefinition`, `StateDefinition`, `createRecipe`, `runRecipe`, `validateDefinition`, `recipe:start`, `state:enter`, `state:exit`, `recipe:end` in either file
- [ ] `WorkflowViewer` embed example is correct and uses current API
- [ ] `recipe-authoring.md` uses `WorkflowDefinition` (with `name`/`initial`/`steps`), `StepDefinition`, `createWorkflow`, `runWorkflow`, `validateWorkflow`
- [ ] Transitions use array syntax `[{ on, target }]` not old `on: {}` object
- [ ] Event types are `workflow:start`, `step:enter`, `step:exit`, `workflow:end`
- [ ] Unreachable step visual mentioned in validation section of index.md
- [ ] No changeset needed (packages/web is private)
