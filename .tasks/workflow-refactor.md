# Task: Workflow Refactor + Provider Config Schema + Pre-flight Validation

## Overview

Two orthogonal changes in one pass:

1. **Rename everything**: `Recipe` → `Workflow`, `State` → `Step`, `state:enter` → `step:enter`, etc.
2. **Provider config schema + pre-flight validation**: providers declare required config; `runWorkflow()` validates all of it before step 1 fires.

These are done together because the rename happens first and the new features sit on top.

---

## Part 1 — Rename Inventory

### engine/src/types.ts

| Old | New |
|-----|-----|
| `RecipeDefinition` | `WorkflowDefinition` |
| `StateDefinition` | `StepDefinition` |
| `StateImplementations<TConfig>` | `StepImplementations<TConfig>` |
| `Recipe<TConfig>` | `Workflow<TConfig>` |
| `DefinitionError` | `WorkflowDefinitionError` |
| `StateDefinition.provider?: string` | `StepDefinition.uses?: string[]` (see Part 2) |
| `ExecutionEvent type: "recipe:start"` | `"workflow:start"` |
| `ExecutionEvent type: "recipe:end"` | `"workflow:end"` |
| `ExecutionEvent type: "state:enter"` | `"step:enter"` |
| `ExecutionEvent type: "state:exit"` | `"step:exit"` |
| `ExecutionEvent field: recipeId` | `workflowId` |
| `ExecutionEvent field: recipeName` | `workflowName` |
| `ExecutionEvent field: stateId` (enter/exit) | `stepId` |
| JSDoc comment "recipe" in types.ts | update to "workflow" |

### engine/src/runner-recipe.ts

| Old | New |
|-----|-----|
| `runRecipe()` | `runWorkflow()` |
| `createRecipe()` | `createWorkflow()` |
| All internal variable names: `recipe`, `recipeId`, etc. | `workflow`, `workflowId`, etc. |

### engine/src/validate.ts

| Old | New |
|-----|-----|
| `validateDefinition()` | `validateWorkflow()` |
| All internal references | updated |

### engine/src/observer.ts

| Old | New |
|-----|-----|
| `CollectingObserver` | stays |
| `CallbackObserver` | stays |
| `composeObservers` | stays |
| All event type strings inside observer | updated to match new event types |

### engine/src/index.ts (public API)

| Old export | New export |
|------------|------------|
| `runRecipe` | `runWorkflow` |
| `createRecipe` | `createWorkflow` |
| `validateDefinition` | `validateWorkflow` |
| `type RecipeDefinition` | `type WorkflowDefinition` |
| `type StateDefinition` | `type StepDefinition` |
| `type StateImplementations` | `type StepImplementations` |
| `type Recipe` | `type Workflow` |
| `type DefinitionError` | `type WorkflowDefinitionError` |
| `triageRecipe` | `triageWorkflow` |
| `triageDefinition` | `triageDefinition` → also export as `triageWorkflowDefinition` (or just rename inline) |
| `implementRecipe` | `implementWorkflow` |
| `implementDefinition` | same pattern |

**Decision**: Just rename cleanly. No backward-compat shims. This is a major version bump.

### engine/src/browser.ts

Same exports as index.ts — update all.

### engine/src/recipes/triage/definition.ts

- Rename exported `triageDefinition` constant → keep as `triageDefinition` (pure data, fine name)
- Change type annotation `RecipeDefinition` → `WorkflowDefinition`
- Change `provider: "observability"` fields → `uses: ["observability"]` (see Part 2 below)

### engine/src/recipes/triage/index.ts

- `createRecipe(triageDefinition, {...})` → `createWorkflow(triageDefinition, {...})`
- Export `triageWorkflow` (was `triageRecipe`)
- Type: `Workflow<TriageConfig>` (was `Recipe<TriageConfig>`)

### engine/src/recipes/implement/definition.ts

Same pattern as triage.

### engine/src/recipes/implement/index.ts

- `createWorkflow(implementDefinition, {...})`
- Export `implementWorkflow` (was `implementRecipe`)

### engine/src/recipes/triage/types.ts

- Any use of `Recipe`, `RecipeDefinition`, `StateDefinition` → updated

### engine/src/recipes/implement/types.ts

- Same.

### engine/src/recipes/triage/steps/*.ts

- Import `WorkflowContext`, `StepResult`, `WorkflowDefinition` etc. from types
- All internal JSDoc comments updated

### engine/src/recipes/implement/steps/*.ts

- Same.

### engine/src/nodes/*.ts

- Import renames only.

### engine/src/runner-recipe.test.ts, engine/src/schema.test.ts, etc.

- All test files: rename imports, rename function calls, rename event type strings in assertions.

---

## Part 2 — Provider Config Schema

### Goal

Each provider declares what credentials it needs. The workflow runner collects all requirements from all steps and validates before step 1.

### New Types (in packages/providers/src/types.ts or a new providers/src/config-schema.ts)

```typescript
/**
 * A single required (or optional) configuration field for a provider.
 * Used by the engine to validate all credentials are present before starting.
 */
export interface ProviderConfigField {
  /** Logical field name (e.g. "apiKey"). Matches the key in the provider's config object. */
  key: string;
  /** Primary env var that satisfies this field (e.g. "DD_API_KEY"). */
  envVar: string;
  /** If true, workflow will fail pre-flight if this env var is not set. Default: true. */
  required?: boolean;
  /** Human-readable description for error messages and docs. */
  description: string;
  /** Default value used when envVar is absent and required is false. */
  default?: string;
}

/**
 * Config schema for a provider. Declare this alongside your provider factory.
 * The engine reads it during pre-flight validation.
 */
export interface ProviderConfigSchema {
  /** Provider role identifier (e.g. "observability", "issueTracker"). */
  role: string;
  /** Human-readable provider name for error messages (e.g. "Datadog"). */
  name: string;
  /** All configuration fields this provider needs. */
  fields: ProviderConfigField[];
}
```

Export both from `packages/providers/src/index.ts`.

### StepDefinition.uses field

In `engine/src/types.ts`, replace `provider?: string` with:

```typescript
/**
 * Provider roles this step depends on (e.g. ["observability", "sourceControl"]).
 * Used by the engine for pre-flight config validation.
 * Each role is looked up in the ProviderRegistry; if the provider has a configSchema,
 * all required fields are validated before the workflow starts.
 *
 * Pure metadata — no runtime routing effect.
 */
uses?: string[];
```

### Pre-flight validation in runWorkflow()

In `runner-recipe.ts`, at the top of `runWorkflow()`, before entering the state machine:

```typescript
// Pre-flight: validate all required provider config across all steps
const preflight = validateWorkflowConfig(workflow.definition, providers);
if (preflight.length > 0) {
  throw new WorkflowConfigError(workflow.definition.name, preflight);
}
```

Where `validateWorkflowConfig` is a new internal function:

```typescript
function validateWorkflowConfig(
  definition: WorkflowDefinition,
  providers: ProviderRegistry,
): Array<{ stepId: string; providerName: string; missingEnvVars: string[] }> {
  const issues: Array<{ stepId: string; providerName: string; missingEnvVars: string[] }> = [];

  for (const [stepId, step] of Object.entries(definition.steps)) {
    if (!step.uses) continue;
    for (const role of step.uses) {
      if (!providers.has(role)) continue; // provider not registered → skip (different error path)
      const provider = providers.get<{ configSchema?: ProviderConfigSchema }>(role);
      if (!provider.configSchema) continue; // provider has no schema → nothing to validate
      const missing = provider.configSchema.fields
        .filter((f) => f.required !== false && !process.env[f.envVar])
        .map((f) => f.envVar);
      if (missing.length > 0) {
        issues.push({ stepId, providerName: provider.configSchema.name, missingEnvVars: missing });
      }
    }
  }

  return issues;
}
```

And `WorkflowConfigError`:

```typescript
export class WorkflowConfigError extends Error {
  constructor(
    workflowName: string,
    issues: Array<{ stepId: string; providerName: string; missingEnvVars: string[] }>,
  ) {
    const lines = issues.map(
      ({ stepId, providerName, missingEnvVars }) =>
        `  step "${stepId}" (${providerName}): ${missingEnvVars.join(", ")}`,
    );
    super(
      `Missing required configuration for workflow "${workflowName}":\n${lines.join("\n")}\n\nSet the missing environment variables and re-run.`,
    );
    this.name = "WorkflowConfigError";
  }
}
```

Export `WorkflowConfigError` from `engine/src/index.ts`.

### Which providers get configSchema

Add `configSchema` as a property on the returned provider object (or as a static property alongside the factory). The clean pattern: the provider factory returns an object that includes `configSchema`.

**Priority list** (most impactful, add to all of these):

| Provider | Role | Required fields (envVar) |
|---|---|---|
| `datadog` | `observability` | `DD_API_KEY`, `DD_APPLICATION_KEY` |
| `sentry` | `observability` | `SENTRY_AUTH_TOKEN` |
| `newrelic` | `observability` | `NR_API_KEY` |
| `cloudwatch` | `observability` | `AWS_REGION` |
| `splunk` | `observability` | `SPLUNK_URL`, `SPLUNK_TOKEN` |
| `elastic` | `observability` | `ELASTIC_URL`, `ELASTIC_API_KEY` |
| `loki` | `observability` | `LOKI_URL` |
| `linear` | `issueTracker` | `LINEAR_API_KEY` |
| `githubIssues` | `issueTracker` | `GITHUB_TOKEN` |
| `jira` | `issueTracker` | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| `github` (source control) | `sourceControl` | `GITHUB_TOKEN` |
| `gitlab` | `sourceControl` | `GITLAB_TOKEN` |
| `claudeCode` | `codingAgent` | `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) |
| `openaiCodex` | `codingAgent` | `OPENAI_API_KEY` |
| `googleGemini` | `codingAgent` | `GEMINI_API_KEY` |

**Note on codingAgent**: `claudeCode` accepts EITHER `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. Mark both as `required: false` with a note in description. The actual "one of these must be set" check is currently done in `validateInputs()` in cli/action config — leave that logic there for now. The configSchema just documents the env vars.

### Update triage and implement definitions

Replace `provider: "observability"` → `uses: ["observability"]` etc. in all StateDefinitions.

**triage/definition.ts:**
```typescript
"dedup-check":       { phase: "learn",  uses: ["observability"],               next: "verify-access", on: { duplicate: "notify" } },
"verify-access":     { phase: "learn",  critical: true,                         next: "build-context" },
"build-context":     { phase: "learn",  uses: ["observability"],  critical: true, next: "investigate" },
"investigate":       { phase: "learn",  uses: ["codingAgent"],    critical: true, next: "novelty-gate" },
"novelty-gate":      { phase: "act",    uses: ["issueTracker"],                 on: { skip: "notify", implement: "create-issue", failed: "notify" } },
"create-issue":      { phase: "act",    uses: ["issueTracker"],                 next: "cross-repo-check", on: { failed: "notify" } },
"cross-repo-check":  { phase: "act",    uses: ["sourceControl"],                on: { local: "implement-fix", dispatched: "notify", failed: "notify" } },
"implement-fix":     { phase: "act",    uses: ["codingAgent"],                  next: "create-pr", on: { failed: "notify" } },
"create-pr":         { phase: "act",    uses: ["sourceControl"],                next: "notify", on: { failed: "notify" } },
"notify":            { phase: "report", uses: ["notification"] },
```

**implement/definition.ts:**
```typescript
"verify-access":  { phase: "learn",  critical: true,                next: "create-issue" },
"create-issue":   { phase: "learn",  uses: ["issueTracker"],  critical: true, next: "implement-fix" },
"implement-fix":  { phase: "act",    uses: ["codingAgent"],          next: "create-pr", on: { failed: "notify" } },
"create-pr":      { phase: "act",    uses: ["sourceControl"],        next: "notify", on: { failed: "notify" } },
"notify":         { phase: "report", uses: ["notification"] },
```

---

## Part 3 — Studio Updates

Studio consumes `RecipeDefinition` and `StateDefinition` from engine. All must be updated.

### Files to update

- `RecipeViewer.tsx` — import `WorkflowDefinition`, `StepDefinition`, `ExecutionEvent`; update event type strings
- `store/editor-store.ts` — all type imports + `applyEvent()` switch on new event type strings (`workflow:start`, `step:enter`, `step:exit`, `workflow:end`); rename field `stateId` → `stepId` in event handling; rename internal `currentStateId` → `currentStepId`, `completedStates` → `completedSteps`
- `lib/definition-to-flow.ts` — type imports only
- `lib/export-typescript.ts` — type imports + any generated code that mentions `RecipeDefinition`
- `layout/elk.ts` — type imports only
- `components/StateNode.tsx` — type imports; consider renaming component to `StepNode.tsx` (optional — internal)
- `components/PropertiesPanel.tsx` — type imports
- `components/SimulationPanel.tsx` — event type strings
- `components/LiveConnectPanel.tsx` — event type strings
- `lib-editor.ts`, `lib-viewer.ts` — public library entry points, update all re-exports

**Decision on component file renames**: Keep `StateNode.tsx` as filename to avoid unnecessary churn. Update type references only. Component renames (RecipeViewer → WorkflowViewer) are optional — if the component is exported from lib-viewer.ts as the public API, rename both. Check lib-viewer.ts to decide.

---

## Part 4 — CLI and Action Updates

### packages/cli/src/main.ts

```typescript
// Before:
import { runRecipe, triageRecipe, implementRecipe } from "@sweny-ai/engine";
import type { TriageConfig, ImplementConfig, WorkflowResult } from "@sweny-ai/engine";

// After:
import { runWorkflow, triageWorkflow, implementWorkflow } from "@sweny-ai/engine";
import type { TriageConfig, ImplementConfig, WorkflowResult } from "@sweny-ai/engine";
// (TriageConfig, ImplementConfig, WorkflowResult names stay the same)

// In run():
result = await runWorkflow(implementWorkflow, implementConfig, providers, runOptions);
result = await runWorkflow(triageWorkflow, triageConfig, providers, runOptions);
```

### packages/action/src/main.ts

Same pattern — same 3 import names change.

---

## Part 5 — Tests

### engine tests

- `runner-recipe.test.ts` — rename all: `createRecipe` → `createWorkflow`, `runRecipe` → `runWorkflow`, `validateDefinition` → `validateWorkflow`, `RecipeDefinition` → `WorkflowDefinition`, `StateDefinition` → `StepDefinition`, event type strings
- `schema.test.ts` — same
- `browser-runner.test.ts` — same
- `recipes/triage/definition.test.ts` — `RecipeDefinition` → `WorkflowDefinition`, `StateDefinition` → `StepDefinition`
- All step test files — import renames only

**Add new tests:**
- `runner-recipe.test.ts`: pre-flight validation tests
  - "throws WorkflowConfigError when required env vars are missing"
  - "reports all missing vars at once (not just first)"
  - "passes when all required vars are present"
  - "skips validation for steps with no uses field"
  - "skips validation for providers with no configSchema"

### cli tests

- `tests/main.test.ts` — `runRecipe` → `runWorkflow`, `triageRecipe` → `triageWorkflow`, `implementRecipe` → `implementWorkflow` in mocks
- `tests/config.test.ts` — no changes needed (config types stay the same)

### action tests

- `tests/main.test.ts` — same mock renames as CLI
- `tests/mapToTriageConfig.test.ts` — same

---

## Part 6 — Changesets

Create `.changeset/workflow-rename-and-config-schema.md`:

```markdown
---
"@sweny-ai/engine": major
"@sweny-ai/studio": major
"@sweny-ai/providers": minor
"@sweny-ai/cli": patch
---

**Breaking**: Rename `Recipe` → `Workflow`, `State` → `Step` throughout the public API.

- `RecipeDefinition` → `WorkflowDefinition`
- `StateDefinition` → `StepDefinition`
- `StateImplementations` → `StepImplementations`
- `Recipe<T>` → `Workflow<T>`
- `DefinitionError` → `WorkflowDefinitionError`
- `runRecipe()` → `runWorkflow()`
- `createRecipe()` → `createWorkflow()`
- `validateDefinition()` → `validateWorkflow()`
- `triageRecipe` → `triageWorkflow`, `implementRecipe` → `implementWorkflow`
- ExecutionEvent type strings: `recipe:start` → `workflow:start`, `state:enter` → `step:enter`, `state:exit` → `step:exit`, `recipe:end` → `workflow:end`
- `StateDefinition.provider` → `StepDefinition.uses` (array of role strings)

**New** (`@sweny-ai/providers`): Providers now expose `configSchema: ProviderConfigSchema` — a declarative list of required env vars.

**New** (`@sweny-ai/engine`): `runWorkflow()` runs pre-flight config validation before step 1. Throws `WorkflowConfigError` listing all missing env vars grouped by step. Export `WorkflowConfigError`.
```

---

## Part 7 — Architecture Doc Updates

`docs/architecture.md` needs:
- All mentions of "recipe" → "workflow" (when referring to the abstraction, not the file concept)
- `RecipeDefinition` → `WorkflowDefinition` in code blocks
- `StateDefinition` → `StepDefinition`
- `runRecipe()` → `runWorkflow()`
- Add section on provider config schema and pre-flight validation under "Provider Taxonomy"
- Update ADL table with new decisions

---

## Execution Order

1. `packages/providers/src/` — add `ProviderConfigField`, `ProviderConfigSchema` types; add `configSchema` to each provider; update index.ts exports
2. `packages/engine/src/types.ts` — all renames + new `WorkflowConfigError` class + `uses` field
3. `packages/engine/src/validate.ts` — rename `validateDefinition` → `validateWorkflow`
4. `packages/engine/src/runner-recipe.ts` — rename `runRecipe` → `runWorkflow`, `createRecipe` → `createWorkflow`; add pre-flight validation
5. `packages/engine/src/observer.ts` — update any event type references
6. `packages/engine/src/recipes/**` — update all definition files and index files
7. `packages/engine/src/nodes/**` — import renames only
8. `packages/engine/src/index.ts` — update all exports
9. `packages/engine/src/browser.ts` and `browser-runner.ts` — update exports
10. `packages/engine/src/**/*.test.ts` — all test files
11. `packages/studio/src/**` — all file updates
12. `packages/cli/src/main.ts` — import renames
13. `packages/action/src/main.ts` — import renames
14. `packages/cli/tests/main.test.ts` — mock renames
15. `packages/action/tests/main.test.ts` and `mapToTriageConfig.test.ts` — mock renames
16. `docs/architecture.md` — doc updates
17. `.changeset/workflow-rename-and-config-schema.md` — create changeset

---

## Rules / Constraints

- **No backward-compat shims** — clean break, major version bump handles it
- **No `any` types** — maintain type safety throughout
- **ConfigSchema is additive to provider objects** — providers still work without it (engine skips validation if no schema present)
- **Pre-flight reads `process.env` directly** — same as the rest of the codebase; no abstraction needed
- **`uses` is optional** — steps without `uses` are not validated (e.g. `verify-access` has no external provider dependency)
- **Fail ALL at once** — collect all missing vars before throwing, never fail on first missing var
- **Tests must pass** — run `npx vitest run` in engine, cli, action after changes
- **Build must pass** — run `npm run build` in each modified package

---

## Done Criteria

- [ ] All TypeScript compiles cleanly (`npm run typecheck` in engine, providers, studio, cli, action)
- [ ] All tests pass (`npx vitest run` in engine, cli, action)
- [ ] `WorkflowConfigError` is thrown with a clear multi-line message when env vars are missing
- [ ] No occurrence of `RecipeDefinition`, `StateDefinition`, `runRecipe`, `createRecipe`, `recipe:start`, `state:enter` in public-facing source files (only in git history)
- [ ] Changeset created with correct bump levels
