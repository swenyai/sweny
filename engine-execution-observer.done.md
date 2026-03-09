# Task: Engine — ExecutionEvent Protocol & RunObserver

## Goal
Add a first-class execution event protocol to the engine. This is the foundational piece
that makes live visualization possible — whether the execution is running locally in the
browser (simulation), in a Node.js process, or in the cloud.

The same `ExecutionEvent` types and `RunObserver` interface power all three.

## Repo context
- Package: `packages/engine`
- Build: `npm run build` inside `packages/engine`
- Tests: `npx vitest run` inside `packages/engine`

## Step 1: Add types to `packages/engine/src/types.ts`

Add after the existing `RunOptions` interface:

```typescript
// ---------------------------------------------------------------------------
// Execution observer protocol
// ---------------------------------------------------------------------------

/**
 * A discrete, serializable event emitted at each lifecycle point of a recipe run.
 *
 * Events are JSON-serializable so they can be forwarded over WebSocket, SSE,
 * or any other transport without transformation.
 */
export type ExecutionEvent =
  | {
      type: "recipe:start";
      recipeId: string;
      recipeName: string;
      timestamp: number;
    }
  | {
      type: "state:enter";
      stateId: string;
      phase: WorkflowPhase;
      timestamp: number;
    }
  | {
      type: "state:exit";
      stateId: string;
      phase: WorkflowPhase;
      result: StepResult;
      /** True when replayed from cache, not freshly executed. */
      cached: boolean;
      timestamp: number;
    }
  | {
      type: "recipe:end";
      status: WorkflowResult["status"];
      duration: number;
      timestamp: number;
    };

/**
 * Observer that receives ExecutionEvents in real-time during a recipe run.
 *
 * Implementations:
 *  - In-memory (for local simulation and testing)
 *  - WebSocket (broadcast to connected studio clients)
 *  - SSE (stream to browser over HTTP)
 *
 * The runner awaits each onEvent call. Keep implementations fast; defer heavy
 * work (e.g. DB writes) asynchronously so they don't block the runner.
 *
 * Errors thrown by onEvent are caught and logged — they do NOT abort the recipe.
 */
export interface RunObserver {
  onEvent(event: ExecutionEvent): void | Promise<void>;
}
```

Add `observer?: RunObserver` to the `RunOptions` interface:
```typescript
export interface RunOptions {
  logger?: Logger;
  beforeStep?(step: StepMeta, ctx: WorkflowContext): Promise<boolean | void>;
  afterStep?(step: StepMeta, result: StepResult, ctx: WorkflowContext): Promise<void>;
  cache?: import("./cache.js").StepCache;
  /** Optional observer for real-time execution events. */
  observer?: RunObserver;
}
```

## Step 2: Wire observer into `packages/engine/src/runner-recipe.ts`

Add a helper function at the top of the file:
```typescript
/** Calls observer.onEvent safely — errors are logged, not thrown. */
async function emit(observer: RunObserver | undefined, event: ExecutionEvent, logger: Logger): Promise<void> {
  if (!observer) return;
  try {
    await observer.onEvent(event);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[observer] onEvent threw for "${event.type}": ${msg}`);
  }
}
```

Then in `runRecipe`, add observer calls at these exact points:

1. **After** `const ctx = ...` and **before** `let currentId = ...`:
```typescript
await emit(options?.observer, {
  type: "recipe:start",
  recipeId: definition.id,
  recipeName: definition.name,
  timestamp: Date.now(),
}, logger);
```

2. **After** cycle/unknown guards and **before** the `beforeStep` hook:
```typescript
await emit(options?.observer, {
  type: "state:enter",
  stateId,
  phase: state.phase,
  timestamp: Date.now(),
}, logger);
```

3. **After** `results.set(stateId, result)` and `completedSteps.push(...)`, **before** the critical abort check:
```typescript
await emit(options?.observer, {
  type: "state:exit",
  stateId,
  phase: state.phase,
  result,
  cached: result.cached ?? false,
  timestamp: Date.now(),
}, logger);
```

   Also add after the beforeStep-skipped branch (inside the `if (proceed === false)` block):
```typescript
await emit(options?.observer, {
  type: "state:exit",
  stateId,
  phase: state.phase,
  result: { status: "skipped", reason: "Skipped by beforeStep hook" },
  cached: false,
  timestamp: Date.now(),
}, logger);
```

   And after the cache-hit branch (inside the cache `if (entry)` block):
```typescript
await emit(options?.observer, {
  type: "state:exit",
  stateId,
  phase: state.phase,
  result,
  cached: true,
  timestamp: Date.now(),
}, logger);
```

4. **After** computing `status` and **before** returning:
```typescript
await emit(options?.observer, {
  type: "recipe:end",
  status,
  duration: Date.now() - start,
  timestamp: Date.now(),
}, logger);
```

## Step 3: Create observer utility implementations

Create `packages/engine/src/observer.ts`:

```typescript
import type { ExecutionEvent, RunObserver } from "./types.js";

/**
 * An in-memory RunObserver that accumulates events into an array.
 * Useful for testing and for local simulation in the studio.
 *
 * @example
 * const obs = new CollectingObserver();
 * await runRecipe(recipe, config, providers, { observer: obs });
 * console.log(obs.events);
 */
export class CollectingObserver implements RunObserver {
  readonly events: ExecutionEvent[] = [];

  onEvent(event: ExecutionEvent): void {
    this.events.push(event);
  }

  /** All state:exit events, in execution order. */
  get stateResults(): Array<Extract<ExecutionEvent, { type: "state:exit" }>> {
    return this.events.filter(
      (e): e is Extract<ExecutionEvent, { type: "state:exit" }> => e.type === "state:exit",
    );
  }
}

/**
 * A RunObserver that forwards events to a callback.
 * Useful for one-liner integrations.
 *
 * @example
 * const obs = new CallbackObserver((e) => ws.send(JSON.stringify(e)));
 */
export class CallbackObserver implements RunObserver {
  constructor(private readonly callback: (event: ExecutionEvent) => void | Promise<void>) {}

  onEvent(event: ExecutionEvent): void | Promise<void> {
    return this.callback(event);
  }
}

/**
 * Compose multiple observers into one.
 * All observers receive every event; errors in one do not affect others.
 */
export function composeObservers(...observers: RunObserver[]): RunObserver {
  return {
    async onEvent(event: ExecutionEvent) {
      await Promise.allSettled(observers.map((o) => o.onEvent(event)));
    },
  };
}
```

## Step 4: Export from `packages/engine/src/index.ts`

Add:
```typescript
export type { ExecutionEvent, RunObserver } from "./types.js";
export { CollectingObserver, CallbackObserver, composeObservers } from "./observer.js";
```

## Step 5: Export from `packages/engine/src/browser.ts`

The browser entry needs observer types for the studio simulation:
```typescript
export type { ExecutionEvent, RunObserver } from "./types.js";
export { CollectingObserver, CallbackObserver, composeObservers } from "./observer.js";
// Also add the runner — it has no Node.js deps, needed for browser simulation
export { runRecipe, createRecipe, validateDefinition, createProviderRegistry } from "./runner-recipe.js";
```

Note: `runRecipe` has no Node.js built-ins — only async/await and Map. It is safe in the browser.
The logger it imports (`consoleLogger`) from `@sweny-ai/providers` — verify this is also browser-safe
(it should just use `console.*`). If it imports any Node.js builtins, create a simple inline fallback.

## Step 6: Tests for the observer

Add to `packages/engine/src/runner-recipe.test.ts` a new describe block:

```typescript
describe("RunObserver", () => {
  it("receives recipe:start and recipe:end events", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } }, { a: async () => ({ status: "success" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });

    expect(obs.events[0]?.type).toBe("recipe:start");
    expect(obs.events.at(-1)?.type).toBe("recipe:end");
  });

  it("receives state:enter and state:exit for each executed state", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn", next: "b" }, b: { phase: "act" } } },
      { a: async () => ({ status: "success" }), b: async () => ({ status: "success" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });

    const types = obs.events.map((e) => e.type);
    expect(types).toEqual(["recipe:start", "state:enter", "state:exit", "state:enter", "state:exit", "recipe:end"]);
  });

  it("state:exit includes the StepResult", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } },
      { a: async () => ({ status: "success", data: { outcome: "done" } }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });

    const exit = obs.stateResults[0];
    expect(exit?.result.status).toBe("success");
    expect(exit?.result.data?.outcome).toBe("done");
  });

  it("observer errors do not abort the recipe", async () => {
    const obs: RunObserver = { onEvent: () => { throw new Error("observer boom"); } };
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } },
      { a: async () => ({ status: "success" }) });
    const result = await runRecipe(r, {}, providers, { ...opts, observer: obs });
    expect(result.status).toBe("completed"); // recipe continues despite observer error
  });

  it("recipe:end status matches the WorkflowResult status", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn", critical: true } } },
      { a: async () => ({ status: "failed", reason: "bad" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });

    const end = obs.events.find((e) => e.type === "recipe:end") as Extract<ExecutionEvent, { type: "recipe:end" }>;
    expect(end.status).toBe("failed");
  });

  it("CollectingObserver.stateResults filters to state:exit events only", async () => {
    const obs = new CollectingObserver();
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } },
      { a: async () => ({ status: "success" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: obs });
    expect(obs.stateResults).toHaveLength(1);
    expect(obs.stateResults[0]?.type).toBe("state:exit");
  });

  it("composeObservers delivers events to all observers", async () => {
    const obs1 = new CollectingObserver();
    const obs2 = new CollectingObserver();
    const composed = composeObservers(obs1, obs2);
    const r = createRecipe<Cfg>({ id: "t", version: "1.0.0", name: "t", initial: "a",
      states: { a: { phase: "learn" } } },
      { a: async () => ({ status: "success" }) });
    await runRecipe(r, {}, providers, { ...opts, observer: composed });
    expect(obs1.events).toHaveLength(obs2.events.length);
  });
});
```

Also import `CollectingObserver`, `CallbackObserver`, `composeObservers` at the top of the test file.

## Success criteria
1. `npm run build` passes in `packages/engine`
2. `npm run typecheck` passes
3. All tests pass including new observer tests
4. `CollectingObserver`, `CallbackObserver`, `composeObservers` are exported from both `./index.js` and `./browser.js`
5. `runRecipe` and `createRecipe` are exported from `./browser.js`
6. `ExecutionEvent` is a discriminated union — TypeScript can narrow by `event.type`

## Commit when done
```
git add packages/engine/src/
git commit -m "feat(engine): ExecutionEvent protocol — RunObserver, CollectingObserver, browser exports"
```
Then rename: `mv engine-execution-observer.todo.md engine-execution-observer.done.md`
