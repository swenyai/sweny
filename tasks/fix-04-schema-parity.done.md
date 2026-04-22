# Fix #4: One schema source, Zod⇄JSON Schema parity

_Part of HARDENING_PLAN.v1.claude.md (P1)._

## Goal

Make the in-code `workflowJsonSchema`, the published `spec/public/schemas/workflow.json`, and the runtime Zod schema (`workflowZ`) enforce the same invariants. Today they drift in three separate directions.

## Why this matters

- `spec.sweny.ai/schemas/workflow.json` is marketed as the canonical schema. IDE tools and CI validators fetch it. Today it's **missing `verify`, `requires`, and `retry` entirely** — workflows that run fine get rejected by editor validators.
- `workflowJsonSchema` in `schema.ts` does have those fields but is weaker than Zod on operator invariants (e.g. `output_matches` doesn't enforce "exactly one of equals/in/matches").
- Marketplace authors can publish workflows that pass the spec's public schema but fail `sweny workflow validate`. That's a credibility problem.

## Current state (what you'll find)

- `packages/core/src/schema.ts`
  - `workflowZ` (Zod) enforces all invariants via `.refine(...)` at roughly lines 97–103, 113–124, 132–134, 47–49, 58–60, 73–75.
  - `workflowJsonSchema` (in-code JSON Schema) at lines 382–580 includes `verify`, `requires`, `retry` but NOT the refines.
- `spec/public/schemas/workflow.json` — hand-maintained, missing `verify`/`requires`/`retry` entirely (confirmed: `grep -c "verify\|requires\|retry"` returns 0).
- `packages/core/src/__tests__/loader.test.ts` already has fixtures for valid/invalid workflows — reuse for parity testing.

## What to do

### Step 1 — strengthen `workflowJsonSchema`

In `packages/core/src/schema.ts`, update `workflowJsonSchema` to express the missing invariants where JSON Schema allows:

- `output_matches[]` items: exactly one of `equals` / `in` / `matches`. Use `oneOf` with three mutually-exclusive variants, or `minProperties: 1 / maxProperties: 1` on the operator fields only.
- `verify`: `minProperties: 1` (must declare at least one check).
- `requires`: `minProperties: 1`.
- Inline skill (`skills.<id>`): require `instruction` OR `mcp` via `anyOf`.
- Inline MCP server: require `command` OR `url` via `anyOf`.

Keep additive properties (`additionalProperties: false` everywhere they already exist).

### Step 2 — generate `spec/public/schemas/workflow.json`

Create a tiny generator so the published schema is always derived from `workflowJsonSchema`:

- New script: `packages/core/scripts/write-public-schema.mjs`
  - Imports `workflowJsonSchema` from `dist/schema.js`
  - Writes JSON (with 2-space indent and a trailing newline) to `spec/public/schemas/workflow.json`
- Add to `packages/core/package.json` build script so `npm run build --workspace=packages/core` runs it after `tsc`.
- Commit the regenerated file.

### Step 3 — conformance test (Zod ≡ ajv)

- Add dev dep: `npm i -D ajv --workspace=packages/core` (ajv is zero-runtime-cost and well-typed).
- New test: `packages/core/src/__tests__/schema-conformance.test.ts`
  - Table of positive + negative fixtures (reuse from `loader.test.ts`: valid workflow, missing entry, wrong nodes type, self-loop w/o max_iterations, bounded self-loop, malformed inline skill, `output_matches` with two operators, empty `verify`, empty `requires`).
  - For each fixture: run through `workflowZ.safeParse(raw)` AND ajv against `workflowJsonSchema`.
  - Assert Zod success matches ajv validity. Mismatch = test failure.
- Test fails if Zod accepts what ajv rejects or vice versa.

### Step 4 — reconcile `spec/public/schemas/workflow.json` publish in Vercel build

- Check `packages/web/vercel.json` and `spec/` build config — ensure the public schema file is copied/served from its current location.
- If the spec site has its own build step that copies `spec/public/`, that still works because we write into that path. No routing change expected.

## Acceptance criteria

- [ ] `workflowJsonSchema` in `schema.ts` enforces the 5 invariants listed above.
- [ ] `spec/public/schemas/workflow.json` is regenerated during `npm run build --workspace=packages/core`.
- [ ] `schema-conformance.test.ts` covers positive + negative fixtures and passes.
- [ ] Zod/ajv disagreement on any fixture fails CI.
- [ ] `npx vitest run --dir packages/core/src` still shows all tests passing.
- [ ] `npm run typecheck --workspace=packages/core` passes.

## Out of scope

- Generating the YAML prose reference from the schema (nice-to-have; skip).
- Changes to `spec/src/content/docs/` prose — those are fine already.
- Adding `$defs` reshuffling for size. Keep structural edits minimal.

## Rollout notes

- The stricter published schema may reject workflows in the wild that passed the old loose one. Run `npx @sweny-ai/core workflow validate` against every file in `github.com/swenyai/workflows` before the next release to confirm; adjust if needed.
- Cloud doesn't fetch the public schema — no cross-repo change required.

## Verify when done

```bash
cd packages/core
npm run build
npm test
grep -c 'verify\|requires\|retry' ../../spec/public/schemas/workflow.json   # expect >0
```
