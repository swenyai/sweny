# Task: Battle-Harden DAG Spec v2 — Comprehensive Runner Tests

## Prerequisite
This task depends on `dag-spec-v2-types-and-runner.todo.md` being **done first**.
The new types and runner must be implemented before you write these tests.
Check that `dag-spec-v2-types-and-runner.done.md` exists before starting.

## Goal
Write a comprehensive, adversarial test suite for the new DAG runner and `createRecipe` /
`validateDefinition`. Cover every routing path, every error condition, and every edge case.
Think like someone trying to break it.

## Repo context
- Package: `packages/engine`
- Tests: `npx vitest run` inside `packages/engine`
- Test file to expand: `packages/engine/src/runner-recipe.test.ts`

## New spec summary (what you're testing)

```typescript
// Pure data definition — no functions
interface RecipeDefinition {
  id: string;
  version: string;
  name: string;
  description?: string;
  initial: string;
  states: Record<string, StateDefinition>;
}

interface StateDefinition {
  phase: "learn" | "act" | "report";
  description?: string;
  critical?: boolean;
  next?: string;       // explicit default successor
  on?: Record<string, string>;  // outcome/status/"*" → stateId or "end"
}

// Implementations injected separately
type StateImplementations<TConfig> = Record<string, (ctx) => Promise<StepResult>>;

interface Recipe<TConfig> {
  definition: RecipeDefinition;
  implementations: StateImplementations<TConfig>;
}

// Errors
interface DefinitionError {
  code: "MISSING_INITIAL" | "UNKNOWN_TARGET" | "MISSING_IMPLEMENTATION";
  message: string;
  stateId?: string;
  targetId?: string;
}
```

Routing resolution order in resolveNext:
1. `on[result.data?.outcome]`  — explicit outcome string
2. `on[result.status]`          — "success" | "skipped" | "failed"
3. `on["*"]`                    — wildcard
4. `state.next`                 — only for success/skipped (not failed)
5. `undefined`                  — stop

## Test categories to cover

### 1. validateDefinition()

```typescript
describe("validateDefinition", () => {
  // Happy path
  it("returns [] for a valid definition")
  it("returns [] when states have no on or next (terminal states)")

  // MISSING_INITIAL
  it("errors when initial does not exist in states")
  it("errors when states is empty and initial is set")

  // UNKNOWN_TARGET — on map
  it("errors when on target does not exist in states")
  it("errors for each invalid target (multiple errors returned)")
  it("does NOT error when on target is 'end' (reserved)")

  // UNKNOWN_TARGET — next
  it("errors when next does not exist in states")
  it("does NOT error when next is 'end'")

  // Valid complex case
  it("returns [] for a definition with wildcard '*' transitions")
  it("returns [] for a definition mixing on and next")
})
```

### 2. createRecipe()

```typescript
describe("createRecipe", () => {
  it("returns a Recipe when definition and implementations are valid")
  it("throws with MISSING_INITIAL message when initial is invalid")
  it("throws with UNKNOWN_TARGET message when on target is invalid")
  it("throws when an implementation is missing for a state")
  it("throws listing ALL missing implementations at once (not just the first)")
  it("throws listing ALL definition errors at once (not just the first)")
  it("error message includes the recipe id")
})
```

### 3. runRecipe() — Routing

```typescript
describe("runRecipe routing", () => {
  // Linear (next)
  it("follows next chain: a → b → c")
  it("stops at a terminal state with no next or on")

  // on: status routing
  it("routes via on['success']")
  it("routes via on['failed'] (non-critical)")
  it("routes via on['skipped']")

  // on: outcome routing (data.outcome takes priority over status)
  it("routes via on[data.outcome] when outcome is set")
  it("data.outcome takes priority over status when both match")
  it("falls through to status when outcome key is missing from on")

  // Wildcard
  it("routes via on['*'] when no specific key matches")
  it("on['*'] is lower priority than explicit outcome and status keys")

  // next as fallback
  it("uses next when on has no matching key (success)")
  it("uses next when on has no matching key (skipped)")
  it("does NOT use next on failed (failed stops unless on['failed'] set)")

  // end
  it("stops successfully when on target is 'end'")
  it("stops successfully when next is 'end'")

  // stop conditions
  it("stops when a non-critical node fails with no on['failed']")
  it("stops when there is no next and no on match")
})
```

### 4. runRecipe() — Critical nodes & abort

```typescript
describe("runRecipe critical nodes", () => {
  it("aborts recipe and returns status:'failed' when critical node fails")
  it("does not execute any states after a critical failure")
  it("non-critical failure sets status:'partial' not 'failed'")
  it("multiple non-critical failures still produce status:'partial'")
  it("all success produces status:'completed'")
})
```

### 5. runRecipe() — Cycle detection

```typescript
describe("runRecipe cycle detection", () => {
  it("detects and aborts on a direct self-loop (a → a)")
  it("detects and aborts on an indirect cycle (a → b → a)")
  it("logs an error message including the cycle node id")
  it("returns status:'failed' on cycle detection")
})
```

### 6. runRecipe() — Unknown node

```typescript
describe("runRecipe unknown node", () => {
  it("aborts and returns status:'failed' when routing leads to unknown state id")
  // Note: createRecipe validates this at construction, but test the runner guard too
  // (e.g. if someone bypasses createRecipe and passes a malformed Recipe directly)
})
```

### 7. runRecipe() — Hooks (beforeStep / afterStep)

```typescript
describe("runRecipe hooks", () => {
  it("calls beforeStep before each state")
  it("skips a state when beforeStep returns false")
  it("skipped state still routes normally via on/next")
  it("calls afterStep after each state (including skipped)")
  it("afterStep receives the correct StepResult")
})
```

### 8. runRecipe() — Cache

```typescript
describe("runRecipe cache", () => {
  it("replays a cached result instead of calling the implementation")
  it("cached result has cached:true on the StepResult")
  it("stores successful results to cache")
  it("does not cache failed results")
  it("does not cache skipped results")
  it("cache failure is non-fatal (cache.set rejection does not abort recipe)")
})
```

### 9. runRecipe() — Result recording

```typescript
describe("runRecipe result recording", () => {
  it("records every executed state in WorkflowResult.steps in execution order")
  it("records name (stateId) and phase on each step")
  it("makes results available in ctx.results for downstream states")
  it("includes duration in WorkflowResult")
})
```

### 10. runRecipe() — Exception handling

```typescript
describe("runRecipe exception handling", () => {
  it("catches thrown Error and records status:'failed' with the error message as reason")
  it("catches thrown non-Error (string) and records it as reason")
  it("a throwing state follows on['failed'] routing if set")
  it("a throwing critical state aborts the recipe")
})
```

### 11. Edge cases

```typescript
describe("edge cases", () => {
  it("works with a single-state recipe (no next, no on) — terminal immediately")
  it("works with 20+ states without performance issues")
  it("state with both on and next — on takes priority")
  it("phase is recorded correctly in steps (learn/act/report)")
  it("description field on StateDefinition does not affect routing")
})
```

## Implementation notes

- Use `vi.fn()` for implementations so you can assert call counts
- Use a real `createProviderRegistry()` (import from engine) for the `providers` arg
- For cache tests, implement a simple in-memory `StepCache` object: `{ get: vi.fn(), set: vi.fn() }`
- Keep each test focused on ONE behavior — no test should verify more than 2 outcomes
- Tests should be deterministic — no timeouts, no real I/O

## Success criteria
1. All new tests pass: `npx vitest run` green in `packages/engine`
2. Coverage of all routing paths documented above
3. No test relies on implementation details — only public API (`createRecipe`, `runRecipe`, `validateDefinition`)

## Commit when done
```
git add packages/engine/src/runner-recipe.test.ts
git commit -m "test(engine): comprehensive DAG spec v2 runner test suite"
```
Then rename: `mv dag-spec-v2-runner-tests.todo.md dag-spec-v2-runner-tests.done.md`
