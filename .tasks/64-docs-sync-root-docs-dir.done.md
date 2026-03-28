# Task 64: Sync root /docs/ directory with Starlight site

## Goal
The `/docs/` directory at the repo root has architectural guides that predate the Starlight docs site. Some are outdated and use old terminology. Sync or remove them.

## Files to audit

### 1. `docs/architecture.md` — OUTDATED
- Uses old terminology: "thin native providers", old step names like `dedup-check`, `verify-access`
- The Starlight site has `advanced/architecture.md` which is more current
- **Action:** Update `docs/architecture.md` to match current terminology (workflow/node/edge/skill, not recipe/state/provider). Update the ASCII diagram to show current triage node names (prepare, gather, investigate, create_issue, implement, create_pr, notify). Keep it as the "source of truth" doc it claims to be, but make it accurate.

### 2. `docs/recipe-authoring.md` — FULLY OUTDATED
- Entire file uses Recipe/State/Provider terminology
- Core types referenced (`RecipeDefinition`, `StateDefinition`) no longer exist — replaced by `Workflow`, `Node`, `Edge`
- **Action:** Rename to `docs/workflow-authoring.md` and rewrite using current types. Or, if `workflows/custom.md` in the Starlight site covers this adequately, add a redirect note and deprecate this file.

### 3. `docs/provider-authoring.md` — PARTIALLY OUTDATED
- Providers are now Skills. The decision tree (Provider vs. MCP server) is still conceptually valid but uses wrong terms.
- **Action:** Update terminology. "Provider" → "Skill" throughout. Update interfaces to match current `Skill` type from `packages/core/src/types.ts`.

### 4. `docs/mcp-servers.md` — CHECK AGAINST STARLIGHT
- May overlap with `advanced/mcp-servers.md` in the Starlight site
- **Action:** Compare both. If the Starlight version is complete, add a note at the top of `docs/mcp-servers.md` pointing to the docs site. Update any stale entries.

### 5. `docs/studio.md` — CHECK AGAINST STARLIGHT
- May overlap with `studio/` pages in the Starlight site
- **Action:** Same approach — if Starlight is complete, add a redirect note.

### 6. `docs/recipes/` — TERMINOLOGY
- Example `.sweny.yml` configs — check if the YAML format is current
- **Action:** Verify YAML examples match current schema. Update any outdated field names.

## Verification
- No remaining references to Recipe/State/Provider in their old meanings
- All TypeScript types referenced actually exist in `packages/core`
- Cross-reference with Starlight docs to avoid contradictions
