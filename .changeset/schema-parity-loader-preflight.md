---
"@sweny-ai/core": patch
---

Close the gaps where the published JSON schemas drifted from the Zod parsers,
the loader bypassed a preflight, and `WorkflowType` was defined three times.

- Evaluator cross-kind: the JSON schema now forbids judge-only fields
  (`rubric`/`pass_when`/`model`) on `value`/`function` evaluators and a `rule`
  on `judge` evaluators, matching `evaluatorZ`. ajv and Zod now agree.
- Inputs type checks: per-type `if/then` constraints on `default` and `enum`
  elements so a `type: number` field with a string default is rejected by ajv
  too, not just Zod.
- Skill schema: added `mcpAliases` to `skill.json` (it was silently rejected
  by `additionalProperties: false`), and the `tools` anyOf branch now requires
  `minItems: 1` so an empty `tools` array with no `instruction`/`mcp` is
  rejected, matching `skillZ`.
- Loader: `validateParsed` now runs the legacy-`verify:` preflight and maps
  the throw to a `SCHEMA` error, so `loadAndValidateWorkflow` and Studio import
  surface the migration message instead of silently stripping a top-level
  `verify:` block.
- `WorkflowType` is single-sourced from `WORKFLOW_TYPES` in `types.ts`; the Zod
  enum and the JSON enum derive from it, with a contract test asserting all
  three agree.
- Dropped the misleading `judge_model`/`judge_budget` JSON `default`
  annotations the Zod parser never applied.
