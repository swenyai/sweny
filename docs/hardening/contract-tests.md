# Contract Tests: Hardening Plan

> Status: active proposal, not yet implemented. Owner: TBD. Companion to
> [`v1-plan.md`](./v1-plan.md), which is closed.

## Why this exists

The `data` skill category landed in `types.ts` and the runtime loader on
2026-04-24, but `spec/public/schemas/skill.json` and the published docs
weren't updated. Custom skills setting `category: data` parsed fine at
runtime and silently failed JSON-Schema validation in any external
tooling that consumed `spec.sweny.ai/schemas/skill.json`. We caught it
on the follow-up review, not at PR time.

That class of bug, *silent drift between two sources of the same fact*,
is the most expensive kind to ship. Tests don't catch it, types don't
catch it, builds don't catch it. The fact is "true" in the place you
looked, and someone else's tooling is broken.

This doc names every place we currently have that exposure, and proposes
a treatment per surface in priority order.

## Treatments, ranked

When a fact lives in two places, pick one in this order:

1. **Generate, don't duplicate.** One source produces the other. The
   workflow JSON Schema does this:
   `packages/core/scripts/write-public-schema.mjs` writes
   `spec/public/schemas/workflow.json` from the `workflowJsonSchema`
   constant. CI guards it via the `Schema — published JSON Schema
   matches generator` job. Adopt this everywhere it's feasible.

2. **Single source of truth.** Export the canonical thing once, import
   everywhere else. PR #177's `SKILL_CATEGORIES` does this for the
   category list.

3. **Drift catcher test.** When 1 and 2 are infeasible (cross-language,
   cross-repo, hand-curated docs), write a test that imports both ends
   of the contract and asserts equality. Cheap, mechanical, fails loudly.

4. **Type-level contract.** Use the type system to make divergence a
   compile error. Best for runtime-only contracts; not portable to the
   spec / schema side.

The guiding rule: a single hardcoded fact in two places is debt. Pay it
when you see it.

### Resolving spec vs runtime conflicts

When the spec and runtime already disagree (S1 is the live example), pick
the canonical side before centralizing. Defaults:

- **Runtime is canonical** when the spec was written aspirationally or
  hand-maintained without enforcement. Update the spec to match. This
  is almost always the right choice.
- **Spec is canonical** only when changing it would break published
  contracts (SemVer-meaningful API users depend on). Then update the
  runtime to be at least as strict.

Loosening (runtime accepts more than the spec) is the safer direction:
existing data passes both. Tightening risks breaking installed users.
When tightening is required, ship it behind a deprecation window.

## Surfaces

Listed worst-first by blast radius. Each surface is one PR-sized task.

### S1. Skill ID regex (HIGH, currently broken)

Three declarations of the runtime regex:

- `packages/core/src/cli/skill.ts:27`: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`
- `packages/core/src/skills/custom-loader.ts:24`: same regex
- `packages/core/src/cli/publish.ts:25`: same regex (used by `sweny publish` to validate marketplace submissions)

All three do an additional `id.includes("--")` check and a `length > 64` cap.
The published spec is divergent:

- `spec/public/schemas/skill.json:14`: `^[a-z][a-z0-9-]*$`

The spec accepts `a--b`, `a-`, and IDs longer than 64 chars; the runtime
rejects all three. The spec rejects IDs starting with a digit; the
runtime accepts them. **External tooling validating against our
published schema gets different answers than our CLI.**

**Treatment:**
- Centralize the regex + length cap + `--` check in `types.ts` as
  `isValidSkillId(id: string): boolean`.
- Import in both call sites.
- Update spec/skill.json's pattern to match the runtime, or accept that
  the spec is the looser contract and the runtime is the stricter
  authoring tool. Document the choice.
- Drift catcher: a parametrized test over a fixed corpus of valid +
  invalid IDs that checks runtime and `Ajv.validate(spec, id)` agree.

### S2. Skill JSON Schema is hand-maintained

`spec/public/schemas/skill.json` is hand-edited; the workflow schema
isn't. This is exactly why the `data` bug shipped.

**Treatment:**
- Add `skillJsonSchema` const in `packages/core/src/schema.ts` (or a new
  `skill-schema.ts`).
- Extend `scripts/write-public-schema.mjs` to also write
  `spec/public/schemas/skill.json`.
- The existing `Schema — published JSON Schema matches generator` CI job
  will then guard skill.json the same way it guards workflow.json.

### S3. Harness directories declared in two shapes

- `packages/core/src/cli/skill.ts:29` declares `HARNESS_DIRS` as a
  `Record<HarnessKey, string>` (CLI needs a Record for help text + lookup).
- `packages/core/src/skills/custom-loader.ts:21` declares `SKILL_DIRS`
  as a string array in priority order (loader needs an ordered scan).

If someone adds `.cursor/skills` to the loader but forgets the CLI, new
scaffolds go to `.claude/` and never get discovered. Same divergence in
reverse for the CLI getting a new harness without the loader scanning it.

**Treatment:**
- Single source of truth in `types.ts`:
  `export const HARNESS_DIRS = [...] as const` ordered by priority,
  each entry `{ key, path }`.
- CLI derives its Record + help text by mapping over it.
- Loader uses it directly for the scan order.

### S4. Hardcoded enums duplicated across spec + runtime

These appear in the published JSON Schema and again in the runtime types
(zod or string union):

| Enum            | Spec location                              | Runtime location                  |
| --------------- | ------------------------------------------ | --------------------------------- |
| MCP transport   | `spec/.../skill.json:100`, `workflow.json:462` | implicit in `McpServerConfig` type |
| EvaluatorKind   | `spec/.../workflow.json:122`               | `types.ts:EvaluatorKind`          |
| EvalPolicy      | `spec/.../workflow.json:308`               | `types.ts:EvalPolicy`             |
| `requires.on_fail` | `spec/.../workflow.json:347`            | `types.ts:NodeRequires.on_fail`   |

The workflow JSON Schema is generated from `workflowJsonSchema`, but
`workflowJsonSchema` itself hardcodes the enum strings instead of
deriving them from the runtime types. So the generator passes its CI
check while the runtime + generator have already diverged from each
other in source.

**Treatment:**
- For each enum, declare it once as `as const` tuple in `types.ts`,
  derive the union type from it.
- Use the tuple inside `workflowJsonSchema` (and the new
  `skillJsonSchema` from S2) so spec output is automatically aligned
  with runtime.

### S5. CLI error formatter contracts

The CLI formats user-facing errors based on shapes returned by core
helpers. If the helper changes its shape, the CLI silently degrades
(falls into the wrong branch, prints a worse message).

Known surfaces:

- `packages/core/src/cli/main.ts:706` reads
  `validation.missing[].category === "unknown"` to split the error
  message into "scaffold one with `sweny skill new`" vs "set the env
  var". PR #177 added the contract test for this one.
- `sweny check` reads `skill.config[].required` and `skill.config[].env`
  to format per-skill missing-config diagnostics. No contract test.
- The `workflow validate` command formats edges, sources, evaluators
  for human-readable output. Several format strings depend on optional
  fields being present; runtime can return them undefined.

**Treatment:**
- For each format-string-to-shape coupling, add a contract test in the
  helper's test file (not the CLI's) that builds a minimal example and
  asserts the shape the CLI relies on.
- The pattern is the test we shipped in `skills-index.test.ts:152`:
  build the smallest input that exercises the discriminator, assert the
  output's discriminator field directly.

### S6. SKILL.md frontmatter contract

The SKILL.md format has runtime fields (`name`, `description`, `category`,
`config`, `mcp`, `mcpAliases`?) and spec docs in
`spec/src/content/docs/skills.mdx`. Markdown isn't trivially programmable.

**Treatment:**
- Lower priority. The `data`-category drift wouldn't have hit users hard
  through this surface (docs follow runtime, not the other way).
- Long term: build-time check that the frontmatter table in skills.mdx
  contains a row for each field declared on the runtime `Skill` type.
  Fail spec build if missing. Defer until S1–S4 ship.

### S7. Workflow type discriminator (just landed)

`workflow_type` arrived in `feat/workflow-type-spec`. The enum lives in
`schema.ts:workflowTypeZ`, gets serialized into `workflowJsonSchema`,
and (per the type's docstring) requires "a new cloud renderer + metric
schema" for each value.

**Treatment:**
- Add a comment in `schema.ts:workflowTypeZ` linking to the cloud
  renderer registry. Future drift catcher: a test that asserts every
  enum value has a registered renderer (live as soon as the registry
  exists).
- Until the registry exists, lean on the docstring + code review.

## Sequencing

A reasonable ship order, each ~half-day-or-less:

1. **S1** (skill ID regex). Highest user-facing risk: external tools
   silently disagree with our CLI. Smallest change.
2. **S2** (generate skill.json). Eliminates a whole class of future
   drift in one move; uses already-proven generator pattern.
3. **S3** (harness dirs). Localizes a real correctness coupling.
4. **S4** (enum centralization). Mostly mechanical once S2 lands.
5. **S5** (CLI formatter contracts). Pick off one helper at a time as
   we touch them. Don't gate on completion.
6. **S6 / S7**: defer.

## Anti-patterns to avoid

- **Don't write integration tests when a unit-level contract test
  works.** Spawning the CLI to assert error formatting is slow,
  brittle, and tests three things at once. Build the helper's output
  directly and assert the shape.
- **Don't add a "list of things to remember to update" comment.**
  Comments rot. The whole point of this plan is to delete the parallel
  copies, not annotate them.
- **Don't generalize prematurely.** No "ContractTestRunner" framework.
  Each surface is a 5-to-20-line test next to the helper it covers.
