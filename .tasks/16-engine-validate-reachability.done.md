# Task 16 — Engine: Validate unreachable steps

## Goal

Add reachability analysis to `validateWorkflow()` in
`packages/engine/src/validate.ts`. A step is *unreachable* if no execution
path from `def.initial` can reach it. Unreachable steps are dead code and
should surface as validation errors so users can fix or remove them.

## Context

- **validate.ts**: `packages/engine/src/validate.ts` — pure function,
  browser-safe, no Node.js deps. Currently only checks:
  - `MISSING_INITIAL` — initial step ID doesn't exist
  - `UNKNOWN_TARGET` — next/on target references a non-existent step
  Add a third check after the others:
  - `UNREACHABLE_STEP` — step exists but can't be reached from initial

- **Algorithm** (BFS/DFS from initial):
  ```
  const visited = new Set<string>();
  const queue = [def.initial];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const step = def.steps[id];
    if (!step) continue;   // already caught by MISSING_INITIAL / UNKNOWN_TARGET
    if (step.next && step.next !== "end") queue.push(step.next);
    for (const t of Object.values(step.on ?? {})) {
      if (t !== "end") queue.push(t);
    }
  }
  for (const stepId of Object.keys(def.steps)) {
    if (!visited.has(stepId)) {
      errors.push({ code: "UNREACHABLE_STEP", message: `step "${stepId}" is unreachable from initial`, stateId: stepId });
    }
  }
  ```
  Only run the reachability pass if there are no `UNKNOWN_TARGET` errors (bad
  targets would give false positives for reachability). Guard with:
  ```
  if (errors.length === 0) { /* run reachability */ }
  ```

- **Type** — `WorkflowDefinitionError` already has `code: string` and
  `stateId?: string` fields (see `packages/engine/src/types.ts`). Just add
  `"UNREACHABLE_STEP"` as a new code — no type changes needed.

## Tests

Add to `packages/engine/src/schema.test.ts` OR create a new
`packages/engine/src/validate.test.ts`:

```typescript
describe("validateWorkflow — reachability", () => {
  it("no error when all steps reachable", () => { ... });
  it("UNREACHABLE_STEP for step not reachable from initial", () => { ... });
  it("does not report UNREACHABLE when UNKNOWN_TARGET errors exist", () => { ... });
  it("handles steps reachable only via on: map", () => { ... });
});
```

Use the fixture pattern already in `schema.test.ts` — small inline definitions.

## Changeset

Create `.changeset/engine-validate-reachability.md`:
```md
---
"@sweny-ai/engine": minor
---
`validateWorkflow()` now detects unreachable steps (code `UNREACHABLE_STEP`).
Steps that have no execution path from the initial step are reported as errors.
```

## Done when

- [ ] Reachability check added to `validate.ts`
- [ ] Guarded by `errors.length === 0` to avoid false positives
- [ ] ≥4 tests added covering: all-reachable, one-unreachable, on-only path, guard condition
- [ ] `npm test` passes in `packages/engine`
- [ ] `npx tsc --noEmit` passes in `packages/engine`
