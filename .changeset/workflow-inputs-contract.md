---
"@sweny-ai/core": minor
---

Add a declared per-run `inputs` contract to workflows. Workflow YAML may now
declare an `inputs:` block (top-level, optional) describing the parameters a
caller can supply at invocation. The CLI validates `--input <json>` against
this declaration, applies defaults for omitted optional fields, and rejects
malformed input with a grouped error message before the executor runs.

The composite GitHub Action gains a corresponding `input:` (string-of-JSON,
forwarded verbatim) so CI callers can thread per-run parameters into a
workflow without bespoke wrapper actions.

Workflows without an `inputs` block accept any JSON object (back-compat;
every existing workflow keeps working unchanged).

Types supported: `string`, `number`, `boolean`, `string[]`. Fields support
`required`, `default`, `description`, and `enum`. The published JSON Schema
at https://spec.sweny.ai/schemas/workflow.json documents the field shape and
the spec site at https://spec.sweny.ai/workflow#inputs documents the
validation rules.

Telemetry contract: cloud observers receive the input *shape* (key names +
declared types) via `summarizeInputShape`, never the values, so workflows
that accept tokens or other secrets as input do not leak them.

New public exports from `@sweny-ai/core`:

- `WorkflowInputs`, `WorkflowInputField`, `WorkflowInputType`,
  `InputValidationError`, `InputValidationResult` types.
- `validateRuntimeInput(declared, raw)` and `summarizeInputShape(declared,
  resolved)` functions.
- `workflowInputsZ` Zod schema.
