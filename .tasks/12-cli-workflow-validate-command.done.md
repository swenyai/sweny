# Task 12 — CLI: `sweny workflow validate <file>` command

## Goal

Add a `sweny workflow validate <file>` command that reads a YAML/JSON workflow
file, runs structural validation, and reports errors. Unlike `workflow run --dry-run`
(which also resolves step implementations), this command only checks the
definition itself — it's fast, offline, and needs no provider configuration.

## Background

`validateWorkflow()` already exists in `@sweny-ai/engine` and returns
`WorkflowDefinitionError[]`. It checks:
- `initial` references a step that exists in `steps`
- All `next` and `on.*` targets are valid step IDs or `"end"`

`loadWorkflowFile()` already exists in `main.ts` and handles YAML/JSON parsing
plus `validateWorkflow` internally (throws if invalid). The new command is
a dedicated UX wrapper that gives structured output and clean exit codes.

## What to build

### 1. `workflowValidateAction` function (exported)

In `packages/cli/src/main.ts`, add after `loadWorkflowFile`:

```typescript
export function workflowValidateAction(file: string, options: { json?: boolean }): void {
  let definition: WorkflowDefinition;
  let raw: unknown;
  try {
    const content = fs.readFileSync(file, "utf-8");
    raw = path.extname(file) === ".json" ? JSON.parse(content) : parseYaml(content);
  } catch (err) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ valid: false, errors: [{ message: err instanceof Error ? err.message : String(err) }] }) + "\n");
    } else {
      console.error(chalk.red(`  Cannot read file: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
    return;
  }

  const errors = validateWorkflow(raw as WorkflowDefinition);

  if (options.json) {
    process.stdout.write(JSON.stringify({ valid: errors.length === 0, errors }, null, 2) + "\n");
  } else {
    if (errors.length === 0) {
      console.log(chalk.green(`  ✓ ${file} is valid`));
    } else {
      console.error(chalk.red(`  ✗ ${file} has ${errors.length} error${errors.length > 1 ? "s" : ""}:`));
      for (const err of errors) {
        console.error(chalk.dim(`    ${err.message}`));
      }
    }
  }

  process.exit(errors.length === 0 ? 0 : 1);
}
```

Note: This does NOT call `loadWorkflowFile()` directly because we want to
validate even partially-invalid files — `loadWorkflowFile` throws on validation
errors (intentional for the run command, wrong here). Instead, parse raw and
call `validateWorkflow()` directly.

### 2. Register the command

After the `workflow export` command registration in `main.ts`:

```typescript
workflowCmd
  .command("validate <file>")
  .description("Validate a workflow YAML or JSON file")
  .option("--json", "Output result as JSON")
  .action(workflowValidateAction);
```

### 3. Tests

Add `describe("workflowValidateAction")` to
`packages/cli/tests/workflow-run.test.ts`:

```typescript
describe("workflowValidateAction", () => {
  let exitSpy, stdoutSpy, consoleLogSpy, consoleErrorSpy;
  beforeEach / afterEach // same pattern as other describe blocks

  it("exits 0 and prints ✓ for a valid file", async () => { ... });
  it("exits 1 and prints errors for an invalid workflow", async () => { ... });
  it("exits 1 when file cannot be read", async () => { ... });
  it("--json outputs { valid: true, errors: [] } for a valid file", async () => { ... });
  it("--json outputs { valid: false, errors: [...] } for an invalid file", async () => { ... });
});
```

The mock setup in `loadModule()` already has `mockValidateWorkflow` and
`mockReadFileSync` — reuse them.

### 4. Changeset

`.changeset/cli-workflow-validate.md`:
```md
---
"@sweny-ai/cli": minor
---

Add `sweny workflow validate <file>` command. Validates a workflow YAML or
JSON file structurally (initial step exists, all transition targets exist) and
exits 0 if valid, 1 if not. Supports `--json` for machine-readable output.
```

## Files to touch

- `packages/cli/src/main.ts` — add `workflowValidateAction` + command registration
- `packages/cli/tests/workflow-run.test.ts` — add test suite
- `.changeset/cli-workflow-validate.md` — new changeset

## Done criteria

- `sweny workflow validate ok.yaml` exits 0 for a valid file
- `sweny workflow validate bad.yaml` exits 1 with human-readable errors
- `sweny workflow validate ok.yaml --json` outputs `{"valid":true,"errors":[]}`
- Cannot-read-file exits 1 with clear message
- All tests pass; typecheck clean
