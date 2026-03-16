# Task 10 — Custom step types in YAML workflows (`--steps` flag)

## Goal

Allow `sweny workflow run` to load custom step type implementations from a
local TypeScript/JavaScript module. This is the key missing piece for
production use: teams can write custom step logic and reference it by a
`type:` key in their YAML workflow file.

## Background

`sweny workflow run my-workflow.yaml` currently only works if every step in
the YAML has a `type` that is a registered built-in (`sweny/*`). Any custom
`type` value throws:

```
Error resolving workflow: Unknown step type "myco/send-alert" in step "notify-ops".
Available types: sweny/verify-access, sweny/build-context, ...
```

Users need to ship their own step implementations alongside their YAML files.

## Design

### Invocation

```bash
sweny workflow run my-workflow.yaml --steps ./my-steps.ts
# or
sweny workflow run my-workflow.yaml --steps ./dist/steps.js
```

The `--steps` module must:
1. Import `registerStepType` from `@sweny-ai/engine`
2. Call `registerStepType({ type, description, impl })` for each custom type
3. Export nothing (it's a side-effect module, like `@sweny-ai/engine/builtin-steps`)

Example `my-steps.ts`:
```typescript
import { registerStepType } from "@sweny-ai/engine";
export {};  // satisfy isolatedModules

registerStepType({
  type: "myco/send-alert",
  description: "Send a PagerDuty alert",
  impl: async (ctx) => {
    // ... custom implementation ...
    return { status: "success" };
  },
});
```

### Implementation approach

Use Node's `--import` / `register` API to dynamically load the module. Since
the CLI runs under `tsx` (or compiled JS), the safest runtime approach is:

```typescript
// In workflowRunAction, after side-effect import of builtin-steps:
if (options.steps) {
  const stepsPath = path.resolve(options.steps as string);
  try {
    await import(stepsPath);  // Node ESM dynamic import — works for .js
  } catch (err) {
    console.error(chalk.red(`Failed to load steps module: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
```

For `.ts` files the CLI is already invoked via `tsx` which can import `.ts`
files directly via dynamic import. No transpilation step needed.

### Flag wiring

In `workflowCmd.command("run")` (in `main.ts`):

```typescript
.option("--steps <path>", "Path to a module that registers custom step types")
```

### Error handling

If `--steps` module throws on import (syntax error, missing dep), catch and
print a clear error with `process.exit(1)`.

If a step in the YAML still can't be resolved after loading `--steps`,
`resolveWorkflow()` will throw `Unknown step type "..."`. The existing error
handling in `workflowRunAction` will catch and print it.

### TypeScript type

The `options` parameter in `workflowRunAction` should be widened to include:

```typescript
steps?: string;
```

Update the `workflowRunAction` signature accordingly.

## Tests

Add to `packages/cli/tests/workflow-run.test.ts`:

**Test: `--steps` path that doesn't exist → exit 1**

Mock `import()` (via `vi.doMock` won't work for dynamic imports; instead mock
`node:fs` to simulate a module-not-found scenario, or spy on `import` — use
whatever approach cleanly tests the error path).

Actually the simplest approach: if the file doesn't exist, `import(path)` rejects with
`ERR_MODULE_NOT_FOUND`. Test that the CLI prints an error and exits 1. You can achieve
this by passing a non-existent path like `"./nonexistent-steps.js"` and testing
the exit behavior.

**Test: `--steps` registers a custom type → resolveWorkflow succeeds**

Use a temp file or an inline approach:
1. Write a small `./test-steps.js` to `/tmp/test-steps.js` that calls
   `registerStepType({ type: "test/custom", ... })`
2. Mock the workflow YAML to reference `type: test/custom`
3. Verify workflowRunAction calls runWorkflow (not exit 1)

If this is too involved, focus on the error path test and add a brief comment
that the happy path is covered by e2e/integration tests.

## Changeset

Create `.changeset/custom-step-types.md`:

```md
---
"@sweny-ai/cli": minor
---

`sweny workflow run` now accepts `--steps <path>` to load a custom step type
module before resolving the workflow. Teams can register their own step
implementations and reference them in YAML workflows alongside built-in types.
```

## Files to touch

- `packages/cli/src/main.ts` — add `--steps` option + load logic in `workflowRunAction`
- `packages/cli/tests/workflow-run.test.ts` — new test cases
- `.changeset/custom-step-types.md` — new changeset

## Done criteria

- `sweny workflow run my.yaml --steps ./steps.ts` loads the module before resolving
- Non-existent `--steps` path prints an error and exits 1
- `npm run typecheck --workspace packages/cli` clean
- `npm test --workspace packages/cli` passes
- Changeset created
