# SWEny Recipe System — Specification

**Version:** 2.0
**Status:** Stable
**Scope:** `@sweny-ai/engine` — `RecipeDefinition`, `Recipe<TConfig>`, runner, observer, validation

---

## 1. Concepts

A **recipe** is a directed acyclic graph (DAG) of named states. Each state performs one unit of work and declares where control flows next. The runner executes states one at a time, in the order determined by transition routing, until it reaches a terminal state or an unrecoverable failure.

Recipes are split into two layers:

| Layer | Type | Serializable | Purpose |
|-------|------|-------------|---------|
| **Definition** | `RecipeDefinition` | Yes (JSON) | Graph structure, metadata, routing rules |
| **Recipe** | `Recipe<TConfig>` | No | Definition + TypeScript implementation functions wired together |

This separation means definitions can be stored, versioned, validated, imported/exported, and rendered visually — without any runtime dependencies.

---

## 2. Data Model

### 2.1 `RecipeDefinition`

The pure-data description of a recipe. No functions.

```ts
interface RecipeDefinition {
  id: string;           // Unique machine-readable identifier, e.g. "triage"
  version: string;      // Semver — increment when the shape changes
  name: string;         // Human-readable label used in logs and UI
  description?: string; // What this recipe does
  initial: string;      // Id of the first state to execute
  states: Record<string, StateDefinition>;
}
```

The `states` map is unordered — all routing is explicit. There is no implied execution order from key order.

### 2.2 `StateDefinition`

One node in the DAG.

```ts
interface StateDefinition {
  phase: "learn" | "act" | "report";
  description?: string;
  critical?: boolean;
  next?: string;
  on?: Record<string, string>;
}
```

See §4 (Phases) and §5 (Routing) for the semantics of each field.

### 2.3 `Recipe<TConfig>`

Combines a definition with its implementations.

```ts
interface Recipe<TConfig> {
  definition: RecipeDefinition;
  implementations: StateImplementations<TConfig>;
}

type StateImplementations<TConfig> = Record<
  string,
  (ctx: WorkflowContext<TConfig>) => Promise<StepResult>
>;
```

Every key in `definition.states` must have a corresponding key in `implementations`. This is enforced at construction time by `createRecipe()`.

### 2.4 `StepResult`

What an implementation returns after executing.

```ts
interface StepResult {
  status: "success" | "skipped" | "failed";
  data?: Record<string, unknown>; // Arbitrary output read by downstream states
  reason?: string;                // Human-readable explanation (especially for skipped/failed)
  cached?: boolean;               // Set by runner when replayed from cache
}
```

Set `data.outcome` (a string) to trigger named transitions in `on:` beyond the default `success`/`skipped`/`failed` keys:

```ts
return { status: "success", data: { outcome: "needs-human-review" } };
// Triggers: on: { "needs-human-review": "escalate" }
```

### 2.5 `WorkflowContext<TConfig>`

The mutable context threaded through every state in a run. Implementations receive this as their only argument.

```ts
interface WorkflowContext<TConfig> {
  config: TConfig;                    // Recipe-specific configuration
  logger: Logger;                     // Structured logger (info/debug/warn/error)
  results: Map<string, StepResult>;   // Accumulated results from completed states
  providers: ProviderRegistry;        // Instantiated provider implementations
}
```

Results are keyed by state id. Downstream states access upstream output via `ctx.results.get("state-id")`.

---

## 3. Execution Model

### 3.1 State Machine

The runner implements a **single-pass state machine**:

1. Start at `definition.initial`.
2. Execute the implementation function for the current state.
3. Resolve the next state via the routing rules (§5).
4. If a next state exists, move to it and repeat.
5. Terminate when the resolved next state is `"end"`, or undefined, or the runner is aborted by a critical failure.

### 3.2 Invariants

- **No cycles.** The runner tracks visited state ids and throws if a state is entered twice.
- **No parallelism.** States execute strictly sequentially.
- **No dynamic states.** All states must be declared in the definition before the recipe runs.
- **Errors are caught.** If an implementation throws, the runner catches it and records `status: "failed"` for that state. The recipe continues unless `critical: true`.

### 3.3 Result Status

| `WorkflowResult.status` | Meaning |
|------------------------|---------|
| `"completed"` | All executed states finished (success or skipped) |
| `"partial"` | One or more non-critical states failed, but execution continued |
| `"failed"` | A `critical: true` state failed; execution aborted |

---

## 4. Phases

Every state belongs to one of three phases. Phase is **advisory** — it controls swimlane grouping in the visual editor and appears in logs. Failure semantics are controlled by `critical`, not by phase.

| Phase | Intent | Typical contents |
|-------|--------|-----------------|
| `learn` | Read-only — gather context | Fetch logs, verify credentials, query APIs |
| `act` | Side effects — change the world | Write code, commit, open PRs, create issues |
| `report` | Communicate results | Send notifications, write summaries |

**Convention:** `learn` states that fail are almost always `critical: true`, because downstream `act` states depend on their output. `report` states are rarely critical — a failed notification should not abort an otherwise successful run.

---

## 5. Transition Routing

After a state executes, the runner resolves the next state using this priority order:

1. **Explicit outcome** — `result.data?.outcome` (a string set by the implementation)
2. **Status** — `result.status` (`"success"`, `"skipped"`, `"failed"`)
3. **Wildcard** — `on["*"]`
4. **Default successor** — `next` (only for `success` and `skipped`; failures without an explicit `on.failed` stop the recipe)
5. **Terminate** — if none of the above resolves, the recipe ends

The resolved key is looked up in `on`. If found, its value is the next state id. The reserved value `"end"` terminates the recipe successfully regardless of where it appears.

### Examples

```ts
// Linear — always proceed to notify after create-pr
{ phase: "report", next: "notify" }

// Branch on outcome — novelty gate
{
  phase: "learn",
  on: {
    "implement":  "create-issue",
    "skip":       "notify",
    "failed":     "notify",
  }
}

// Fail-safe — route failures to cleanup, let success fall through to next
{
  phase: "act",
  next: "create-pr",
  on: { "failed": "notify" }
}
```

---

## 6. Critical States

When `critical: true` is set on a state:

- If the implementation returns `status: "failed"` **or** throws, the runner immediately aborts.
- `WorkflowResult.status` is set to `"failed"`.
- No subsequent states execute.
- The observer still receives `recipe:end`.

Use `critical: true` for states whose output is required by everything downstream — typically the first `learn` state in a recipe (e.g. `verify-access`).

---

## 7. Observer Protocol

During a run, the runner emits a stream of serializable `ExecutionEvent` values:

```ts
type ExecutionEvent =
  | { type: "recipe:start";  recipeId: string; recipeName: string; timestamp: number }
  | { type: "state:enter";   stateId: string;  phase: WorkflowPhase; timestamp: number }
  | { type: "state:exit";    stateId: string;  phase: WorkflowPhase; result: StepResult; cached: boolean; timestamp: number }
  | { type: "recipe:end";    status: WorkflowResult["status"]; duration: number; timestamp: number };
```

Events are JSON-serializable and designed for transport over WebSocket, SSE, or any other channel.

Pass an observer via `RunOptions.observer`:

```ts
await runRecipe(recipe, config, registry, { observer: myObserver });
```

Built-in implementations in `@sweny-ai/engine`:

| Observer | Description |
|----------|-------------|
| `CollectingObserver` | Accumulates all events into an array — for testing and local simulation |
| `CallbackObserver` | Forwards each event to a callback function |
| `composeObservers` | Multiplexes multiple observers; an error in one does not affect others |

**Contract:** The runner awaits each `onEvent` call. Keep implementations fast. If an observer throws, the error is caught and logged — it does not abort the recipe.

---

## 8. Validation

Three layers validate a recipe, each catching different classes of error:

| Layer | When | What it checks |
|-------|------|---------------|
| **TypeScript types** | Compile time | Shape of definition, implementation signatures |
| **`validateDefinition()`** | Run time (browser-safe) | Referential integrity — all `initial`, `next`, and `on` targets exist in `states` or are `"end"` |
| **JSON Schema** (`schema/recipe-definition.schema.json`) | External tooling | Required fields, semver format, phase enum values |

`createRecipe(definition, implementations)` runs `validateDefinition()` and additionally verifies that every state id has a corresponding implementation. It throws a `DefinitionError` on any violation.

`validateDefinition()` is a pure function with no Node.js dependencies — safe for browser use (e.g. real-time validation in the Studio editor).

### Error codes

| Code | Meaning |
|------|---------|
| `MISSING_INITIAL` | `definition.initial` does not exist in `states` |
| `UNKNOWN_TARGET` | A `next` or `on` target does not exist in `states` and is not `"end"` |
| `MISSING_IMPLEMENTATION` | A state id has no corresponding implementation (checked by `createRecipe`) |

---

## 9. `createRecipe()` and `runRecipe()`

### `createRecipe(definition, implementations)`

Validates the definition, checks implementation completeness, and returns a `Recipe<TConfig>`. Throws on any validation error.

```ts
import { createRecipe } from "@sweny-ai/engine";

const myRecipe = createRecipe(myDefinition, {
  "verify-access": verifyAccess,
  "do-work":       doWork,
  "notify":        sendNotification,
});
```

### `runRecipe(recipe, config, registry, options?)`

Executes the recipe and returns a `WorkflowResult`.

```ts
const result = await runRecipe(recipe, config, registry, {
  logger,           // Logger instance — falls back to console
  beforeStep,       // (meta, ctx) => Promise<boolean | void> — return false to skip
  afterStep,        // (meta, result, ctx) => Promise<void>
  cache,            // StepCache — replays prior successful results
  observer,         // RunObserver — receives ExecutionEvents in real-time
});
```

`beforeStep` returning `false` skips the state — it is recorded as `status: "skipped"` and routing continues as if the implementation had returned that status.

---

## 10. Design Principles

**Separation of definition and implementation.** Definitions are pure data so they can be serialized, stored, versioned, visually rendered, and validated without any runtime environment. Implementations are injected at wiring time.

**Explicit routing over implicit ordering.** Every transition is declared in `on:` or `next`. There is no implicit "run the next item in the array" behavior. This makes routing auditable and renderable as a graph.

**Outcome-driven branching.** Implementations set `data.outcome` to drive branching beyond the built-in `success`/`skipped`/`failed` statuses. This keeps branching logic inside the implementation where it belongs, separate from the graph structure.

**Fail-safe defaults.** A `failed` state with no `on.failed` route stops the recipe with `status: "partial"`. Recipes only continue past failures when the author explicitly handles them.

**Browser safety.** `validateDefinition()`, `RecipeDefinition`, and all type definitions are free of Node.js dependencies. The Studio can validate, render, and simulate recipes entirely in the browser.
