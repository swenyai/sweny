# SWEny Hardening Plan — v1

_Synthesis of three agent-generated reviews (`REVIEW_RECOMMENDATIONS.md`, `HARDENING_REVIEW.md`, `LIBRARY_REVIEW.md`), validated against the current codebase and aligned to the project soul._

## Executive Summary

The two reviews agree on one thing worth acting on immediately: **SWEny's core trust contract — that `verify` reflects actual tool outcomes — is broken today**. Every other finding is downstream of that or cosmetic.

After validating every claim against the code, this plan:

1. Confirms 13 of 15 findings are real (two are overstated).
2. Ranks them by load-bearing impact on the project soul, not by review ordering.
3. Explicitly rejects two items that would drift the product away from its stated direction.

The headline: **fix `verify` first**, then tighten validation at the edges (CLI + marketplace), then clean up everything else.

## Soul Alignment

From `cloud/SOUL.md`:
- "Every PR comment is a billboard" — if verify lies, the billboard advertises a failure as a success.
- "Collect now, use later" — every run outcome is a training signal. Poisoned signals corrupt future intelligence.
- "Simplicity is the moat" — strict modes, feature flags, and capability toggles violate this. Hardening should remove, not add, surface area.
- "The Action is the engine. The cloud is the brain." — the engine has to be right or the brain is built on lies.

From `/Users/nate/.claude/memory/`:
- `feedback_no_half_measures` — fix root causes, don't paper over symptoms.
- `feedback_value_over_features` — polish what exists before building more.
- `feedback_no_feature_flags_greenfield` — ship one honest code path, not a toggle.

This plan assumes: **no new user-facing surface, no configuration knobs, no strict/best-effort modes**. Just make what we ship match what we say.

## Claim Validation Summary

Every review claim was verified against code on disk. Status legend:

| Status | Meaning |
|--------|---------|
| ✅ Validated | Exact finding reproduces in code |
| ✅+ Worse | Validated, but narrower than reality — see notes |
| ⚠️ Partial | Symptom real, mechanism misstated |
| ❌ Rejected | Finding does not reflect current code |

### HARDENING_REVIEW.md claims

| # | Title | Status | Evidence |
|---|-------|--------|----------|
| 1 | `verify` tool-call semantics | ✅+ Worse | `packages/core/src/claude.ts:134-146` pushes a provisional `tool_use` with **no `output` field**, then `coreToolToSdkTool` at `:307-323` pushes a second entry with output. `verify.ts:86-98` infers success from `output` shape, so the provisional entry always "succeeds". **External MCP tools (mcpServers prop) never get the SDK wrapper — their outcome is always silently "success"** regardless of whether they errored. |
| 2 | Capability boundary softness | ✅ Validated | `claude.ts:112-113, 216-217, 270-271` all set `permissionMode: "bypassPermissions"` and `allowDangerouslySkipPermissions: true`. `README.md:59` and `ARCHITECTURE.md:33` claim "scoped tools". Gap is real; recommended fix (add strict mode) is **rejected** below. |
| 3 | Browser entry not browser-safe | ✅ Validated | `browser.ts:31` re-exports `execute` from `executor.ts`. `executor.ts:116-117` uses `process.cwd()`/`process.env`; `executor.ts:36` imports `source-resolver.ts` which imports `node:fs/promises` and `node:path`. A browser bundler following this graph will fail without polyfills. |
| 4 | Source resolution duplication | ✅ Validated | `cli/main.ts:191-193` calls `loadAdditionalContext()` which builds its own `defaultCtx` with hardcoded `authConfig: {}, offline: false` (`templates.ts:64-72`). The CLI then passes `offline`/`fetchAuth` to the executor at `:410-411`. Rules/context are resolved with one policy; Sources resolved by executor use another. |
| 5 | MCP wiring duplicated | ✅ Validated | `mcp.ts:39-204` (`buildSkillMcpServers`) and `mcp.ts:215-406` (`buildAutoMcpServers`) each hand-encode all 12+ providers. Any new provider requires editing both in lockstep. |
| 6 | `npx -y` policy by code | ✅+ Worse | `mcp.ts:81` uses `@sooperset/mcp-atlassian` (community, not first-party) under `npx -y` — violates the documented policy in `ARCHITECTURE.md:60-68` which limits the exception to official vendor packages. `asana` is also wired under `npx -y` in both builders but was dropped from `SUPPORTED_WORKSPACE_TOOLS` (`cli/config.ts:353`), making the wiring dead-ish. |
| 7 | JSON schema weaker than Zod | ✅ Validated | Missing from `workflowJsonSchema` (`schema.ts:382-580`): exactly-one-of operator in `output_matches` entry, at-least-one check in `verify`, at-least-one check in `requires`, inline skill requires instruction-or-mcp, MCP server requires command-or-url. Zod enforces all five (`schema.ts:47,58,97-102,113-124,132-134`). |
| 8 | Custom skill discovery silent | ✅ Validated | `skills/custom-loader.ts:40-42,51,54-56,131-133` every failure path is a silent `continue` or `return null`. No warnings surfaced anywhere. |
| 9 | Studio skipped state | ✅ Validated | `studio.ts:177-180` maps `skipped` → `failed`. The type union at `:63` explicitly permits `skipped`, but the event handler never produces it. |
| 10 | CLI numeric parsing NaN | ✅ Validated | `cli/config.ts:252-253,315` use `parseInt(String(x), 10)` which yields `NaN` for invalid input. Bounds checks at `:594-599` use `< 1 / > 500` — NaN fails both comparisons and slips through. |
| 11 | Build/test/release hygiene | ⚠️ Partial | Tests compile into `dist` (verified: `dist/executor.test.js`, `dist/mcp.test.js`, etc.) because `tsconfig.json` includes all of `src`. `package.json:46` publishes the entire `dist`. Claim that **default `vitest run` picks up dist tests** is unverified — vitest's default exclude does cover `dist`. Core problem (tests in published artifact) is real; severity is "unprofessional" not "broken". `packages/create-sweny/package.json` confirmed has no `test` script. |

### LIBRARY_REVIEW.md claims

| # | Title | Status | Evidence |
|---|-------|--------|----------|
| L1 | Inline workflow skills rejected by CLI | ✅ Validated | `cli/main.ts:676` calls `validateWorkflowSkills` using a skills map built from `configuredSkills(process.env)` — which does NOT include `workflow.skills` (inline definitions). Meanwhile `executor.ts:75` calls `mergeInlineSkills(options.skills, workflow.skills)` to add them at runtime. Result: a spec-valid workflow with inline skills is rejected by the CLI before the executor ever sees it. The validator treats unmapped IDs as `category: "unknown"` (`skills/index.ts:149`) and produces a hard error. |
| L2 | Dry-run inconsistency | ✅ Validated | `workflow run --dry-run` (`cli/main.ts:654-662`) exits after printing node IDs. The executor's real dry-run path in `advanceFromNode()` is never reached. Public docs (`packages/web/src/content/docs/workflows/index.md`) describe execution that stops at the first conditional edge — a different contract. `action.yml` has no `dry-run` input, so Action users literally cannot invoke the documented feature. |
| L3 | Stale JSON Schema at spec.sweny.ai | ✅ Validated — NEW severity | `spec/public/schemas/workflow.json` (served publicly at `https://spec.sweny.ai/schemas/workflow.json`) has **zero** occurrences of `verify`, `requires`, or `retry`. The core's in-memory `workflowJsonSchema` (`schema.ts:454+`) has all three. IDE validation and CI schema checks against the public URL will reject workflows the runtime accepts. This is a worse schema drift than HARDENING #7 identified — that review assumed the problem was weak invariants; the real problem is missing whole fields. |
| L4 | Multiple schemas in circulation | ✅ Validated | Four workflow contracts exist today: runtime Zod (`workflowZ` in `schema.ts`), in-code JSON Schema (`workflowJsonSchema`), published JSON Schema (`spec/public/schemas/workflow.json`), public YAML reference prose (`packages/web/src/content/docs/workflows/yaml-reference.md`). No single source of truth. |
| L5 | Root `docs/` carries stale terminology | ⚠️ Partial | `docs/recipe-authoring.md` marked deprecated (good). Other files (`docs/studio.md`, `docs/architecture.md`) still reference "recipes" / "providers" inconsistently. Severity is low — internal docs, not user-facing. |

### REVIEW_RECOMMENDATIONS.md claims

| # | Title | Status | Evidence |
|---|-------|--------|----------|
| 1 | CLI validate doesn't parse with Zod first | ✅ Validated | `cli/main.ts:23` imports `parseWorkflow` but never calls it. `workflowValidateAction` (`:851`) and `loadWorkflowFile` (`:632`) both call `validateWorkflowSchema` directly on raw data. `parseWorkflow` IS correctly used by `publish.ts:62` — so the two paths have divergent trust. |
| 2 | Marketplace install writes before validating | ✅+ Worse | `cli/marketplace.ts:301-409` (`installMarketplaceWorkflow`): Zod validation only runs inside the `if (mismatches.length > 0 && claude)` branch (`:316-343`). When there are no mismatches (most common case) or no Claude available, the workflow is written **unvalidated**. Additionally, `writeSwenyYmlIfMissing` and `appendMissingEnvKeys` (`:383, 387`) mutate the user's project **before** any validation. |
| 3 | Skill publish not recursive | ✅ Validated | `publish.ts:415-418, 480-483` both use `fs.readdirSync` + `fs.copyFileSync` in a flat loop. `fs.copyFileSync` throws `EISDIR` on directories, so a skill with `scripts/` or `references/` subdirs fails hard rather than copying incomplete. |
| 4 | Docs/spec drift on self-loops & schema URL | ✅ Validated | `packages/web/src/content/docs/workflows/yaml-reference.md:202` says "An edge cannot have the same from and to value" — contradicts `spec/.../edges.mdx:92` and `schema.ts:242-248` which both allow bounded self-loops. Schema URL drift: web docs use `https://sweny.ai/schemas/workflow.json` (`yaml-reference.md:215, 278`); spec docs and `schema.ts:384` use `https://spec.sweny.ai/schemas/workflow.json`. |
| 5 | Unified loader | ✅ Validated (as design) | Today there are at least three load paths: `workflow run` (`main.ts:632`), `workflow validate` (`main.ts:854`), `publish` (`publish.ts:56`). Only `publish` uses Zod. |
| 6 | Expand negative-path tests | ⚠️ Partial | Valid in spirit but **rejected as a standalone task**. Negative tests belong with each fix, not as a separate epic. |
| 7 | Tighten product language | ❌ Rejected | Premature. Copy tightens itself once behavior is honest. Defer until P0–P3 ship. |

## Priorities — Ordered by Soul Impact

### P0 — Trust the Data (engine correctness)

**Fix #1: `verify` tool-call accounting.** This is the single finding that threatens the project's core mission. Without it, every run report the Action streams to cloud is a potential lie, and cloud-side intelligence is built on noise.

Work:
1. In `claude.ts`, remove the provisional `tool_use` push at `:134-146` (or tag it with a `status: "pending"` and dedupe on completion). The `coreToolToSdkTool` wrapper is already the authoritative event source for in-process tools.
2. Wire a tool-result capture for **external MCP tools** (the `mcpServers` prop). Today their outcomes are invisible — no output means verify's `isErrorOutput` always returns `false`, so they always "succeed". Options:
   - Listen for MCP `tool_result` messages in the SDK stream and pair them with `tool_use` by id.
   - If the SDK doesn't surface per-tool results, document the limitation in `verify.ts` and have `any_tool_called` / `all_tools_called` require in-process tools only (with a clear error for users who ask us to verify external MCP tools we can't observe).
3. Replace the `isErrorOutput` output-shape heuristic with an explicit `ToolCall.status: "success" | "error"` field. Update `succeededTools`, `checkAnyToolCalled`, `checkAllToolsCalled` to key on `status`.
4. Keep `no_tool_called` semantics as-is — it's already correct (name-set based, erring on the side of conservative).
5. Regression tests:
   - In-process tool throws → `any_tool_called` fails.
   - In-process tool throws → `all_tools_called` fails.
   - External MCP tool succeeds → `any_tool_called` passes (once event wired).
   - External MCP tool fails → `any_tool_called` fails (once event wired, or explicit error if not).
   - Placeholder tool_use followed by error → counted once, as failure.

**Cloud compat check:** `cloud-report.ts` does not serialize `ToolCall` shape into its wire body (only `results` status + aggregated data), so this fix is wire-compatible with cloud today. Still, grep for `ToolCall` consumers before shipping.

### P1 — Trust at the Edges (validation boundaries)

**Fix #2: One canonical workflow loader.** Replace the three paths with one.

Work:
1. Create `loadAndValidateWorkflow(filePath: string, { knownSkills? }): { workflow, warnings }` in `schema.ts` (or a new `loader.ts`).
2. Steps: read → parse YAML/JSON → `workflowZ.parse()` (Zod, throws structured errors) → `validateWorkflow()` (structural).
3. Replace direct callers:
   - `main.ts:632` `loadWorkflowFile`
   - `main.ts:851` `workflowValidateAction`
   - `publish.ts:53-62` `validateWorkflowFile`
   - `marketplace.ts:318-322` inline parse
4. Remove the dead `parseWorkflow` import at `main.ts:23`.
5. Regression tests: missing required fields, wrong types, malformed inline skills, invalid self-loop without `max_iterations`, unreachable nodes.

**Fix #3: Marketplace install validates before any write.**

Work:
1. In `installMarketplaceWorkflow` (`marketplace.ts:301`), hoist `workflowZ.parse(parseYaml(fetched.yaml))` to run immediately after fetch, outside the `if (mismatches.length > 0 && claude)` branch.
2. Abort install cleanly if parse fails. Distinguish schema failure (stop) from adaptation failure (fall through with un-adapted original, as today).
3. Move `writeSwenyYmlIfMissing` and `appendMissingEnvKeys` (`:383, 387`) **after** the final workflow YAML is validated.
4. Regression tests: malformed marketplace YAML aborts install cleanly, nothing written; invalid schema content aborts install cleanly; valid content with adaptation failure proceeds with original.

**Fix #4: One schema to rule them all.**

The published schema at `spec.sweny.ai/schemas/workflow.json` is **missing entire fields** that the runtime supports (`verify`, `requires`, `retry`). And the in-code `workflowJsonSchema` (which does have them) is weaker than Zod on several invariants. Four contracts, one should win.

Work:
1. Make `schema.ts`'s `workflowJsonSchema` the canonical JSON Schema source. It already has `verify`/`requires`/`retry`.
2. Strengthen `workflowJsonSchema` in `schema.ts:382-580` to match Zod refines:
   - `output_matches` exactly-one-operator via `oneOf`
   - `verify` and `requires` at-least-one-check via `minProperties: 1` (pragmatic) or explicit `anyOf`
   - Inline skill and MCP server required-field unions
3. Generate `spec/public/schemas/workflow.json` from `workflowJsonSchema` in a build step (tiny `scripts/write-schema.mjs`). Delete the hand-maintained copy. Spec build asserts the generated file matches what's checked in.
4. Conformance test: load `spec/public/schemas/workflow.json` via `ajv`, feed positive and negative fixtures through both Zod and ajv. Any disagreement fails CI.
5. One-shot: regenerate the public YAML reference from the same fixtures + canonical schema, so drift can't re-enter through prose.

**Fix #5 (new): Align inline-skill validation with the executor.**

Work:
1. In `cli/main.ts:676`, build the validation skill map from `mergeInlineSkills(configured, workflow.skills)` — the same transform the executor uses.
2. Alternatively, move the merge into `createSkillMap` and pass the workflow in.
3. Regression test: a workflow with an inline skill defined in `workflow.skills` and referenced from a node passes CLI validation and runs.
4. The `validateWorkflowSkills` function itself is fine — the bug is in what's passed to it.

**Fix #6 (new): Pick one dry-run contract.**

Two options:
- **(a) Keep the lightweight "print node list" behavior** as `--list-nodes` (or similar) and make `--dry-run` invoke the executor's real dry-run path that stops at the first conditional edge. Fix docs to match. Add `dry-run: true` input to `action.yml`.
- **(b) Delete `--dry-run` from the CLI and docs entirely**; keep only executor-level dry-run available via library usage.

Recommend **(a)** — users expect dry-run to mean "would this work if I ran it" and the executor's real path delivers that.

Regression tests: dry-run stops at first conditional edge; dry-run exits 0 on a valid linear workflow; Action `dry-run: true` passes through.

### P2 — Trust the UI (cloud-facing correctness)

**Fix #7: Studio skipped state.** One-line fix at `studio.ts:177-180` to map `skipped` through. Add a test. Cloud's `LiveRunViewer` and `WorkflowViewer` (both consumed from `@sweny-ai/studio`) will render correctly once the lib is rebuilt.

**Fix #8: Browser entry honesty.** Remove `execute` from `browser.ts`'s re-exports. Anything that can't bundle without `node:fs` does not belong in the browser entry. Add a bundle test (vite or esbuild CLI) that compiles `browser.ts` with browser target and fails on node: imports. Document the reduced surface.

**Fix #9: Skill loader diagnostics.** Change `discoverSkills` (`custom-loader.ts:28-61`) to return `{ skills, warnings }`. Warnings for: malformed frontmatter, invalid skill ID, unreadable file, duplicate-id override. `configuredSkills` still returns just skills for backward compatibility. CLI flows (`sweny workflow run`, `sweny publish`, `sweny workflow validate`) surface warnings as yellow bullets.

**Fix #10: CLI numeric parsing.** Add a `parsePositiveInt(value, fieldName, min, max): number` helper in `cli/config.ts`. Uses `Number.parseInt` + `Number.isFinite`. Replace the three call sites. Validation errors include the actual offending value.

### P3 — Honest Docs

**Fix #11: Reconcile self-loop docs.** Update `packages/web/src/content/docs/workflows/yaml-reference.md:202,206` to match the spec: self-loops allowed with `max_iterations`, forbidden without. (Mostly superseded by Fix #4 if the YAML reference is regenerated.)

**Fix #12: Fix schema URL drift.** Update `yaml-reference.md:214-215, 278` to `https://spec.sweny.ai/schemas/workflow.json`. Grep the rest of `packages/web/` for any other stale `sweny.ai/schemas` references.

**Fix #13: Document capability reality.** One paragraph in `ARCHITECTURE.md` and `README.md` honestly explaining: SWEny wires MCP tools scoped per node, AND the underlying Claude Code subprocess has access to its built-in Bash/Read/Write tools without permission prompting (`bypassPermissions`). This is intentional to preserve agentic capability in CI. No strict mode added.

**Fix #14: Clean up stale terminology in docs and comments.** Grep root `docs/` for "recipe" (outside of the already-deprecated `recipe-authoring.md`) and "provider" where the product now uses "skill". Either update or clearly mark archival. Same pass covers public docs in `packages/web/src/content/docs/` where "provider" language is out of date. Low-priority; bundle with Fix #11/#12 in one docs PR. This absorbs the terminology portion of the previously separate Gemini skill-migration proposal.

### P4 — Code Hygiene (after everything above)

**Fix #15: One MCP registry.** Extract a declarative catalog (array of `{ id, trigger: ("skill" | "provider" | "workspace-tool"), transport, auth, npxExceptionReason? }`). Rewrite both `buildSkillMcpServers` and `buildAutoMcpServers` as thin projections of the catalog. Add table-driven tests. Removes ~180 lines of duplication. While we're in `mcp.ts`, rename internal `sourceControlProvider`/`issueTrackerProvider`/`observabilityProvider` references to use "skill" consistently — piggybacking the cosmetic cleanup from the retired skill-migration proposal, at zero additional cost.

**Fix #16: Source resolution unification.** Delete `loadAdditionalContext`'s hardcoded `defaultCtx` and thread `offline`/`fetchAuth` from the CLI all the way to `resolveSource`. Keep one path: rules/context are Sources, resolved by the same resolver as everything else.

**Fix #17: Recursive skill publish.** Replace shallow `readdirSync` + `copyFileSync` in `publish.ts:415-418, 480-483` with `fs.cp(src, dst, { recursive: true })`. Add test with nested directories and a non-Markdown asset.

**Fix #18: `npx -y` policy enforcement.** Add `{ transport: "stdio", npxExceptionReason: string | null }` to each catalog entry. `asana`: mark dead or re-enable in `SUPPORTED_WORKSPACE_TOOLS`. `jira`: either add `@sooperset/mcp-atlassian` to the exception list with an explicit rationale, or migrate to a first-party server. Test: every entry with `transport: "stdio"` must have a non-null `npxExceptionReason`.

**Fix #19: Build/test hygiene.**
- `tsconfig.json`: add `"exclude": ["src/**/*.test.ts", "src/__tests__/**"]` or emit tests to `dist-tests/`.
- `package.json:45-47`: optionally narrow `files` to explicit subpaths.
- `packages/create-sweny/package.json`: add `"test": "echo \"create-sweny is a wrapper; see @sweny-ai/core\" && exit 0"` or similar; do not leave undefined.
- Add a `packing-test` CI step that runs `npm pack --dry-run` and asserts no `.test.` files in the output.

## Skill-Migration Proposal (reviewed separately)

A prior `SKILL_MIGRATION_PLAN.gemini.md` proposed renaming "Provider" → "Skill" across user-facing surfaces: CLI flags, `.sweny.yml` keys, `action.yml` inputs, and docs. Reviewed and mostly rejected — here's why:

**Context check:**
- `action.yml` **has no provider inputs today**. It runs `sweny workflow run "$WORKFLOW_PATH"` and nothing else. The Gemini plan's Action migration was written against a stale mental model.
- `sweny workflow run` (the primary user path) already uses `buildSkillMcpServers` — the skill-driven MCP wiring. No rename needed there.
- `--observability-provider`, `--issue-tracker-provider`, etc. survive only in the legacy `sweny triage` and `sweny implement` commands, which are already on an implicit deprecation path.

**What to pull in:**
- Internal variable/comment rename from "provider" → "skill" in files we're already editing for P4 Fix #15 (MCP catalog). `mcp.ts:210, 429-450` references `sourceControlProvider`/`issueTrackerProvider` — since we're rewriting this file anyway, rename at the same time. No additional work, no merge conflict.
- Expand P3 Fix #14 to include "provider" terminology cleanup in root `docs/` where it's stale against the product.

**What to reject:**
- New `--*-skill` CLI flags aliased to `--*-provider`. Adds surface area, creates two ways to say the same thing, and the legacy commands are on a deprecation path anyway. If/when `triage`/`implement` retire, the flags retire with them.
- `.sweny.yml` key aliases (`observability-skills` etc.). Same reasoning — adds parallel keys with deprecation warnings that must be maintained forever.
- `action.yml` changes — nothing to migrate; the Action is already skill-native.

**Decision:** no separate skill-migration workstream. Cosmetic renames hitch-hike on P4 Fix #15. No new user-facing aliases. If `triage`/`implement` deserve a naming cleanup, do it at the moment they're retired or frozen — not now.

## Rejected Recommendations

These appeared in the reviews but are not in this plan.

**HARDENING #2 — "Add a strict capability mode."** SWEny does not serve enterprise yet (per SOUL). A strict mode is a configuration knob for a user segment we don't have. Document the current behavior honestly (Fix #11) and revisit when the first enterprise prospect asks. Building modes before they're asked for violates "simplicity is the moat".

**REVIEW #7 — "Tighten marketing language."** Defer. Copy should follow behavior. Once P0–P3 ship, the honest copy is a small pass, not a work item.

**HARDENING #12 — "Hardening conformance suite."** Tempting but premature. Each P0–P4 fix lands with its own regression tests. A meta-suite built now would codify the current imperfect surface. Revisit after P4 when surface has stabilized.

**REVIEW #6 — "Negative-path test epic."** Not a separate task. Each fix above ships with negative tests.

## Execution Order

| Phase | Fixes | Rough sizing |
|-------|-------|--------------|
| P0 | #1 | 1–2 days (verify semantics + external MCP path) |
| P1 | #2, #3, #4, #5, #6 | 3–4 days (bundled; one unified loader + schema generation + inline-skill + dry-run) |
| P2 | #7, #8, #9, #10 | 1 day (all small, independent) |
| P3 | #11, #12, #13, #14 | 2 hours (docs only) |
| P4 | #15, #16, #17, #18, #19 | 2–3 days (parallelize after P0–P3 are green) |

**Shipping guidance:**
- P0 ships alone as its own release. It's the single most important correctness fix in the library.
- P1 ships as one bundled PR — the loader refactor touches all the consumers and they should move together.
- P2 items are independent; ship in any order.
- P3 is a single docs PR.
- P4 items can each be their own PR; sequence doesn't matter.

## Risks & Rollout Notes

1. **P0 touches the reporter-to-cloud path indirectly.** `cloud-report.ts` currently reads `NodeResult.status` only (not `toolCalls` individually), so the wire format is safe. Verify nothing in `@sweny-ai/action` serializes `ToolCall` into a cloud body before shipping.
2. **P1 Fix #2 (strict Zod load) may break workflows that structurally "worked" but had type drift.** Before shipping, `npx @sweny-ai/core workflow validate` every workflow in `swenyai/workflows` (marketplace) and in `.sweny/workflows/` of this repo. If any fail Zod that passed `validateWorkflow`, decide: fix the workflow, or soften Zod. Prefer fixing the workflow.
3. **P2 Fix #6 (browser entry) removes `execute` from the browser export.** If cloud's `@sweny-ai/studio` consumer pulls `execute` from `@sweny-ai/core/browser`, it will break at next publish. Grep `/Users/nate/src/swenyai/cloud/src` and `packages/studio/src` for `@sweny-ai/core/browser` before shipping.
4. **P4 Fix #12 (MCP catalog) is wire-compatible** — users get the same MCP env keys they always had. Test table must cover every current provider. The refactor is pure — no behavior change intended.
5. **No feature flags. No toggles. No admin knobs.** Every fix ships as the new default path, deleting the old one.

## Open Questions

1. Does the Claude Agent SDK emit a stream event for external MCP tool completion that we can correlate with the provisional `tool_use`? If yes, P0 fully fixes external MCP verify. If no, we need the explicit error-on-unobservable-tool branch. **Action: read `@anthropic-ai/claude-agent-sdk` types for `tool_result` events before writing the P0 PR.**
2. Are there marketplace workflows in the wild today that pass `validateWorkflow` but fail `workflowZ.parse()`? **Action: run the P1 loader against `github.com/swenyai/workflows` before shipping P1.**
3. ~~Skill-migration sequencing vs P4 #15~~ **Resolved.** The Gemini skill-migration plan was evaluated and folded in: internal rename piggybacks on P4 Fix #15, docs cleanup absorbed into P3 Fix #14, user-facing flag aliases rejected. The source file is deleted.

## What This Plan Does NOT Do

To prevent scope creep, explicit non-goals:

- Not adding a strict mode or permission toggle.
- Not replacing MCP-first with bespoke wrappers.
- Not removing `npx -y` from legitimate vendor MCP cases.
- Not creating a standalone "conformance suite" before the individual fixes.
- Not rewriting the docs marketing copy.
- Not changing the wire format between Action and Cloud.
- Not adding feature flags or rollout gates.
- Not introducing new user-facing configuration.

## Meta

Source material (all deleted — this plan supersedes them):
- `REVIEW_RECOMMENDATIONS.md` — agent-generated, validation/marketplace-focused.
- `HARDENING_REVIEW.md` — agent-generated, runtime-correctness-focused.
- `LIBRARY_REVIEW.md` — agent-generated, contract-drift-focused. Contributed the `verify`/`requires`/`retry`-missing-from-public-schema finding and the inline-skill CLI bug.
- `SKILL_MIGRATION_PLAN.gemini.md` — agent-generated, provider→skill rename proposal. Mostly rejected; small cleanup portion folded into P3/P4.

Every load-bearing claim was verified against the code on disk before being included here. Items that didn't survive validation were rejected explicitly rather than dropped quietly.
