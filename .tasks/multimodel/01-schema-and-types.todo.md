# Task 01 — Per-node execution model: schema + types

**Feature:** Multi-model cost tiering (GitHub issue #207, design in `.tasks/issue-multimodel.md`).
**This task:** Add the optional `model` field to the workflow data model so a node (or the whole workflow) can name the execution model. No executor wiring yet (that is Task 02).

## Why
A workflow DAG mixes hard reasoning steps with mechanical grunt steps. Authors want a cheap model on the grunt steps and a strong model on the reasoning steps. This task adds the schema surface; later tasks resolve and use it.

## Background you need
- Canonical validator is **Zod** in `packages/core/src/schema.ts`, not the TS interface. `nodeZ` is `.strict()` (rejects unknown keys); `workflowZ` is intentionally **not** `.strict()` (it strips unknown top-level keys for marketplace metadata, see comment near its definition). So `model` MUST be added to both Zod objects to be preserved/validated.
- The public JSON schema `spec/public/schemas/workflow.json` is **generated** from the `workflowJsonSchema` constant in `schema.ts` by `packages/core/scripts/write-public-schema.mjs` during `npm run build`, and gated by `npm run check:schema-drift`. **Never hand-edit the JSON file.**
- Precedent: `judge_model` already exists at node + workflow level. Mirror its shape and placement.

## Files
- `packages/core/src/types.ts` — add `model?: string` to `Node`, to `Workflow`, and to the `Claude.run` opts in the `Claude` interface.
- `packages/core/src/schema.ts` — add `model: z.string().min(1).optional()` to `nodeZ` and `workflowZ`; add a `model` JSON-schema property to the `workflowJsonSchema` node `properties` and workflow-root `properties` (next to `judge_model`).
- `spec/public/schemas/workflow.json` — regenerate via `npm run build --workspace=packages/core` (do not hand-edit).

## Tests
- `packages/core/src/__tests__/schema.test.ts` — accepts `model` on a node and at workflow root; rejects empty-string `model` (minLength).
- `packages/core/src/__tests__/schema-conformance.test.ts` — positive fixture (node + workflow with `model`) and a negative fixture (empty-string node `model`), so the Zod/AJV parity suite exercises the new field.
- `packages/core/src/__tests__/spec-conformance.test.ts` — assert `nodeProps.model` is declared in the generated schema.

## Acceptance
- `model` is free-text passthrough (no registry), consistent with `judge_model`.
- `npm run build --workspace=packages/core` regenerates `workflow.json` with `model` at node + workflow level.
- `npm run check:schema-drift --workspace=packages/core` is clean.
- `npx vitest run` (in `packages/core`) green; `npm run typecheck` green.

## Verification
```
npm run build --workspace=packages/core
npm run check:schema-drift --workspace=packages/core
npm run typecheck --workspace=packages/core
cd packages/core && npx vitest run schema
```
