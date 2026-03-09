# Task: Implement DAG Spec v2 — Types, Factory & Runner

## Goal
Replace the current `nodes[]`-array-based Recipe format with a `states{}`-map-based format
that is fully serializable (no embedded functions), validated at construction time, and
compatible with future visual editing.

This is the **foundational task** — everything else (tests, migration, visualization) depends on it.

## Repo context
- Monorepo at `/Users/nate/src/swenyai/sweny`
- Package: `packages/engine`
- Build: `npm run build` inside `packages/engine`
- Typecheck: `npm run typecheck` inside `packages/engine`
- Tests: `npx vitest run` inside `packages/engine`
- npm scope: `@sweny-ai/engine`

## Files to modify

| File | Action |
|---|---|
| `packages/engine/src/types.ts` | Replace Recipe/RecipeStep types with new spec (see below) |
| `packages/engine/src/runner-recipe.ts` | Rewrite runner to use new Recipe shape |
| `packages/engine/src/runner-recipe.test.ts` | Update existing tests to use new format |
| `packages/engine/src/index.ts` | Update exports if needed |

Do NOT touch recipe files under `src/recipes/` — that is a separate migration task.

## Current state (what you're replacing)

### Current `types.ts` relevant section:
```typescript
export interface RecipeStep<TConfig = unknown> {
  id: string;
  phase: WorkflowPhase;
  run: (ctx: WorkflowContext<TConfig>) => Promise<StepResult>;
  on?: Record<string, string>;
  critical?: boolean;
}

export interface Recipe<TConfig = unknown> {
  name: string;
  description?: string;
  start: string;
  nodes: RecipeStep<TConfig>[];
}
```

### Current runner builds nodeMap from nodes[]:
```typescript
const nodeMap = new Map<string, RecipeStep<TConfig>>();
const nodeOrder: string[] = [];
for (const node of recipe.nodes) {
  nodeMap.set(node.id, node);
  nodeOrder.push(node.id);
}
```
And resolveNext falls back to "next in array order" for success/skipped — this implicit behavior goes away.

## New spec to implement

### New types (replace everything in the Recipe/RecipeStep section of types.ts):

```typescript
// ---------------------------------------------------------------------------
// Recipe Spec v2 — states{} map, pure serializable definition
// ---------------------------------------------------------------------------

/**
 * A pure-data recipe definition. Fully serializable — no functions.
 * Can be stored in JSON, versioned, and rendered as a visual graph.
 * Implementations are injected separately via createRecipe().
 */
export interface RecipeDefinition {
  /** Unique machine-readable identifier (for persistence and import/export). */
  id: string;
  /** Semver string, e.g. "1.0.0". Increment when the shape changes. */
  version: string;
  /** Human-readable name used in logs. */
  name: string;
  /** Optional description of what this recipe does. */
  description?: string;
  /** Id of the first state to execute. Must be a key in `states`. */
  initial: string;
  /**
   * All states keyed by their unique id.
   * Order is irrelevant — all routing is explicit via `on` and `next`.
   */
  states: Record<string, StateDefinition>;
}

export interface StateDefinition {
  /** Phase for swimlane grouping and failure semantics. */
  phase: WorkflowPhase;
  /** Human-readable description (shown in visual editor, not executed). */
  description?: string;
  /**
   * If true, any failure immediately aborts the entire recipe (status: "failed").
   * Use for states whose output is required by everything downstream.
   */
  critical?: boolean;
  /**
   * Explicit default successor state (for linear chains).
   * Used when no `on` key matches the resolved outcome.
   * Shorthand for `on: { success: "...", skipped: "..." }`.
   */
  next?: string;
  /**
   * Outcome-based transition map.
   *
   * Key resolution order:
   *   1. result.data?.outcome (string)  — explicit outcome set by implementation
   *   2. result.status                  — "success" | "skipped" | "failed"
   *   3. "*"                            — wildcard default
   *
   * After `on` is exhausted, falls back to `next` (success/skipped only).
   *
   * Reserved target value: "end" — stops the recipe successfully.
   */
  on?: Record<string, string>;
}

/**
 * Implementation functions keyed by state id.
 * Every state id in RecipeDefinition.states must have an entry here.
 */
export type StateImplementations<TConfig> = Record<
  string,
  (ctx: WorkflowContext<TConfig>) => Promise<StepResult>
>;

/**
 * A complete wired recipe ready to run.
 * Definition is pure data; implementations are the actual async functions.
 */
export interface Recipe<TConfig = unknown> {
  definition: RecipeDefinition;
  implementations: StateImplementations<TConfig>;
}

/** Validation error describing a structural problem with a RecipeDefinition. */
export interface DefinitionError {
  code:
    | "MISSING_INITIAL"      // initial does not exist in states
    | "UNKNOWN_TARGET"       // an on/next target does not exist in states and isn't "end"
    | "MISSING_IMPLEMENTATION"; // a state id has no implementation (checked by createRecipe)
  message: string;
  stateId?: string;
  targetId?: string;
}
```

### New functions to add to types.ts (signatures only — implement in runner-recipe.ts or a new file):

```typescript
/**
 * Validate a RecipeDefinition for structural correctness.
 * Returns an array of errors (empty array = valid).
 * Does NOT check implementations (use createRecipe for that).
 */
export declare function validateDefinition(def: RecipeDefinition): DefinitionError[];

/**
 * Create a Recipe by combining a definition with implementations.
 * Validates the definition and that all state ids have implementations.
 * Throws a descriptive Error if validation fails.
 */
export declare function createRecipe<TConfig>(
  definition: RecipeDefinition,
  implementations: StateImplementations<TConfig>,
): Recipe<TConfig>;
```

### Implement validateDefinition():

```typescript
export function validateDefinition(def: RecipeDefinition): DefinitionError[] {
  const errors: DefinitionError[] = [];
  const stateIds = new Set(Object.keys(def.states));

  // initial must exist
  if (!stateIds.has(def.initial)) {
    errors.push({
      code: "MISSING_INITIAL",
      message: `initial state "${def.initial}" does not exist in states`,
    });
  }

  // all on/next targets must be valid state ids or "end"
  for (const [stateId, state] of Object.entries(def.states)) {
    if (state.next && state.next !== "end" && !stateIds.has(state.next)) {
      errors.push({
        code: "UNKNOWN_TARGET",
        message: `state "${stateId}" next target "${state.next}" does not exist`,
        stateId,
        targetId: state.next,
      });
    }
    for (const [outcome, target] of Object.entries(state.on ?? {})) {
      if (target !== "end" && !stateIds.has(target)) {
        errors.push({
          code: "UNKNOWN_TARGET",
          message: `state "${stateId}" on["${outcome}"] target "${target}" does not exist`,
          stateId,
          targetId: target,
        });
      }
    }
  }

  return errors;
}
```

### Implement createRecipe():

```typescript
export function createRecipe<TConfig>(
  definition: RecipeDefinition,
  implementations: StateImplementations<TConfig>,
): Recipe<TConfig> {
  const defErrors = validateDefinition(definition);
  if (defErrors.length > 0) {
    throw new Error(
      `Invalid recipe definition "${definition.id}":\n` +
        defErrors.map((e) => `  [${e.code}] ${e.message}`).join("\n"),
    );
  }

  const implErrors: DefinitionError[] = [];
  for (const stateId of Object.keys(definition.states)) {
    if (!implementations[stateId]) {
      implErrors.push({
        code: "MISSING_IMPLEMENTATION",
        message: `state "${stateId}" has no implementation`,
        stateId,
      });
    }
  }
  if (implErrors.length > 0) {
    throw new Error(
      `Missing implementations for recipe "${definition.id}":\n` +
        implErrors.map((e) => `  [${e.code}] ${e.message}`).join("\n"),
    );
  }

  return { definition, implementations };
}
```

### Rewrite runRecipe() to use new Recipe shape:

The runner logic stays mostly the same, but:
- `recipe.nodes` → `Object.entries(recipe.definition.states)`
- No nodeOrder array needed (states is a map)
- `recipe.start` → `recipe.definition.initial`
- `recipe.name` → `recipe.definition.name`
- `node.run(ctx)` → `recipe.implementations[stateId](ctx)`
- `resolveNext` uses new resolution order (see below)

New resolveNext logic:
```typescript
function resolveNext(
  stateId: string,
  state: StateDefinition,
  result: StepResult,
): string | undefined {
  const outcome = typeof result.data?.outcome === "string" ? result.data.outcome : undefined;

  if (state.on) {
    // 1. explicit outcome
    if (outcome && outcome in state.on) return state.on[outcome];
    // 2. status
    if (result.status in state.on) return state.on[result.status];
    // 3. wildcard
    if ("*" in state.on) return state.on["*"];
  }

  // 4. next (only for non-failure)
  if (result.status !== "failed" && state.next) return state.next;

  // 5. stop
  return undefined;
}
```

Note: Remove the old `nodeOrder` / declaration-order fallback entirely. All routing is now explicit.

### Update runRecipe signature:

The signature stays the same:
```typescript
export async function runRecipe<TConfig>(
  recipe: Recipe<TConfig>,
  config: TConfig,
  providers: ProviderRegistry,
  options?: RunOptions,
): Promise<WorkflowResult>
```

But internally it uses `recipe.definition` and `recipe.implementations`.

The `WorkflowResult.steps` array `name` field should be the stateId (same as before).

## Update existing runner tests

The file `packages/engine/src/runner-recipe.test.ts` has tests for the current format.
Update all tests to use the new `createRecipe(definition, implementations)` pattern.

Example translation:
```typescript
// OLD:
const recipe: Recipe<void> = {
  name: "test",
  start: "a",
  nodes: [
    { id: "a", phase: "learn", run: async () => ({ status: "success" }) },
    { id: "b", phase: "act", run: async () => ({ status: "success" }) },
  ],
};

// NEW:
const recipe = createRecipe<void>(
  {
    id: "test",
    version: "1.0.0",
    name: "test",
    initial: "a",
    states: {
      a: { phase: "learn", next: "b" },
      b: { phase: "act" },
    },
  },
  {
    a: async () => ({ status: "success" }),
    b: async () => ({ status: "success" }),
  },
);
```

## Exports

Make sure `packages/engine/src/index.ts` exports:
- `validateDefinition`
- `createRecipe`
- All new types: `RecipeDefinition`, `StateDefinition`, `StateImplementations`, `DefinitionError`
- Remove: `RecipeStep` (no longer needed)
- Keep: `Recipe`, `WorkflowContext`, `StepResult`, `WorkflowResult`, `WorkflowPhase`, `RunOptions`, `StepMeta`, `ProviderRegistry`

## Success criteria
1. `npm run build` passes in `packages/engine`
2. `npm run typecheck` passes in `packages/engine`
3. `npx vitest run` passes in `packages/engine` (existing runner tests updated and green)
4. `createRecipe` throws a descriptive error when given bad definitions or missing implementations
5. `validateDefinition` returns typed `DefinitionError[]` without throwing

## Commit when done
```
git add packages/engine/src/types.ts packages/engine/src/runner-recipe.ts packages/engine/src/runner-recipe.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): DAG spec v2 — states{} map, createRecipe factory, explicit routing"
```
Then rename this file: `mv dag-spec-v2-types-and-runner.todo.md dag-spec-v2-types-and-runner.done.md`
