# Task 22 — Engine: step execution timeouts

## Goal

Long-running steps (e.g., a coding agent that hangs, a network call that never
returns) currently block forever. Add a `timeout` field to `StepDefinition` so
operators can cap how long a step runs before it is marked `failed`.

This is a **reliability** feature: production users need to know their CI job
will eventually finish even if a provider is down or a coding agent is stuck.

## Context

- **`packages/engine/src/types.ts`** — `StepDefinition` interface, add `timeout?: number` (milliseconds). Also add `"STEP_TIMEOUT"` to `WorkflowDefinitionError.code` union (for `validateWorkflow` check). Actually we don't need a validation error — just runtime enforcement.
- **`packages/engine/src/browser-runner.ts`** — `runWorkflow` executes each step by calling `implementations[stepId](ctx)`. Wrap with `Promise.race([impl(ctx), timeoutPromise])`.
- **`packages/engine/src/runner-recipe.ts`** — Same pattern; also enforces timeout here.
- **`packages/engine/src/schema.ts`** — YAML schema has `StepDefinitionSchema`. Add `timeout: z.number().int().positive().optional()`.
- **`packages/engine/src/validate.ts`** — Optionally validate `timeout > 0` but this is already covered by the Zod schema.

## What to implement

### 1. Type change

In `packages/engine/src/types.ts`, add to `StepDefinition`:

```typescript
/**
 * Maximum milliseconds this step may run before being forcibly failed.
 * When omitted, no timeout is enforced.
 */
timeout?: number;
```

### 2. Runtime enforcement (browser-runner.ts and runner-recipe.ts)

Create a helper (inline is fine):

```typescript
function withTimeout<T>(promise: Promise<T>, ms: number, stepId: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Step "${stepId}" timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
```

In `runWorkflow`, where `implementations[stepId](ctx)` is called, wrap it:

```typescript
let resultPromise = implementations[stepId](ctx);
const step = def.steps[stepId];
if (step?.timeout && step.timeout > 0) {
  resultPromise = withTimeout(resultPromise, step.timeout, stepId);
}
const result = await resultPromise;
```

When the timeout fires, the step should be recorded as `failed` with reason
`"timed out after Nms"`. The existing error-handling path in `runWorkflow`
already does this — a thrown error from an implementation is caught and the
step is marked `failed`.

### 3. Schema update

In `packages/engine/src/schema.ts`, update `StepDefinitionSchema`:

```typescript
timeout: z.number().int().positive().describe("Max milliseconds before forcibly failing this step").optional(),
```

### 4. YAML schema comment

Update `WORKFLOW_YAML_SCHEMA_HEADER` in the schema file to mention `timeout`
in the StepDefinition section comment.

## Changeset

```md
---
"@sweny-ai/engine": minor
---
Steps now support a `timeout` field (milliseconds). When set, the step is
forcibly failed if it does not complete within the allotted time. Works in
both the Node.js runner and the browser-safe runner.
```

## Tests

Add to `packages/engine/src/browser-runner.test.ts` (or a new file):

1. A step with `timeout: 100` that resolves after 200ms → result.status === "failed" with reason containing "timed out"
2. A step with `timeout: 200` that resolves after 50ms → result.status === "success" (timer cleared)
3. A step with no timeout → behaves normally (existing tests already cover this)
4. A step with `timeout: 0` → treated as no timeout (or rejected by schema)

For the slow test, use `vi.useFakeTimers()` to avoid making tests take 200ms.

## Done when

- [ ] `timeout?: number` in `StepDefinition`
- [ ] `withTimeout` helper in both runners
- [ ] Schema validates `timeout` is positive integer
- [ ] Tests added and passing
- [ ] `npx tsc --noEmit` passes in `packages/engine`
- [ ] Changeset created
