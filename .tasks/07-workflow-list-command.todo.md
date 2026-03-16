# Task 07 — `sweny workflow list` CLI command

## Goal

Add `sweny workflow list` so a developer can discover all registered built-in
step types without reading source code. Useful before authoring a YAML workflow.

## Background

`packages/engine/src/builtin-steps.ts` registers 12 step types via `registerStepType()`.
The registry lives in `packages/engine/src/step-registry.ts` as `builtinStepRegistry`
(a `Map<string, StepType>` — intentionally NOT exported from the public API).

`StepType` has `{ type: string; description: string; impl: AnyStepImpl }`.

The Studio has a richer static catalog at `packages/studio/src/lib/step-types.ts`
(`BUILTIN_STEP_TYPES`) that also has `label`, `phase`, and `uses`. The engine's
runtime registry only has `type` and `description`.

## What to build

### 1. Export `listStepTypes()` from the engine

In `packages/engine/src/step-registry.ts`, add:

```typescript
/**
 * Return all registered step types.
 * Call this after importing '@sweny-ai/engine/builtin-steps' to include the built-ins.
 */
export function listStepTypes(): Array<{ type: string; description: string }> {
  return [...builtinStepRegistry.values()].map(({ type, description }) => ({ type, description }));
}
```

Export `listStepTypes` from `packages/engine/src/index.ts` (no type-only export — it's a function).

### 2. Add `sweny workflow list` subcommand in CLI

In `packages/cli/src/main.ts`, add to the existing `workflowCmd` Commander command:

```typescript
workflowCmd
  .command("list")
  .description("List all registered built-in step types")
  .option("--json", "Output as JSON array")
  .action((options) => workflowListAction(options));
```

Export `workflowListAction` as a named export for testability (matching the
pattern used by `workflowRunAction` and `workflowExportAction`).

Implementation:

```typescript
export function workflowListAction(options: { json?: boolean }): void {
  import "@sweny-ai/engine/builtin-steps"; // side-effect: populates registry
  const types = listStepTypes();

  if (options.json) {
    process.stdout.write(JSON.stringify(types, null, 2) + "\n");
    return;
  }

  // Human-readable grouped output
  console.log(chalk.bold("\nBuilt-in step types:\n"));
  for (const { type, description } of types) {
    console.log(`  ${chalk.cyan(type)}`);
    console.log(chalk.dim(`    ${description}`));
  }
  console.log();
}
```

### 3. Tests

Add to `packages/cli/tests/workflow-run.test.ts` (or a new file
`workflow-list.test.ts`) using the same `vi.doMock + vi.resetModules + await import`
pattern as the other CLI tests.

Test cases:
- Default output: calls `console.log` with each type and description
- `--json`: writes JSON array to `process.stdout.write`, valid JSON with `type` and `description` fields
- Output includes `"sweny/verify-access"` (spot-check against known registry entry)

### 4. Changeset

Create `.changeset/workflow-list-command.md`:

```md
---
"@sweny-ai/engine": patch
"@sweny-ai/cli": patch
---

Add `listStepTypes()` to engine for introspecting the built-in step registry.
Add `sweny workflow list` CLI command to print all registered step types (human and `--json` output).
```

## Files to touch

- `packages/engine/src/step-registry.ts` — add `listStepTypes()`
- `packages/engine/src/index.ts` — export `listStepTypes`
- `packages/cli/src/main.ts` — add `workflow list` subcommand + export `workflowListAction`
- `packages/cli/tests/workflow-list.test.ts` — new test file
- `.changeset/workflow-list-command.md` — new changeset

## Done criteria

- `sweny workflow list` prints a readable list of step types and descriptions
- `sweny workflow list --json` prints valid JSON
- All new code passes `npm run typecheck` and `npm test` in both packages
- Changeset file created
