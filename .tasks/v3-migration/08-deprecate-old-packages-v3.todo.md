# Task 08: Deprecate Old Packages + Version Bump to v3

## Why
With Studio and docs migrated to `@sweny-ai/core`, the old packages (`engine`, `providers`, `agent`) are no longer needed. They should be marked deprecated and `@sweny-ai/core` should be published as v3.0.0.

## What to do

### 1. Publish @sweny-ai/core
- Bump `packages/core/package.json` version to `3.0.0`
- Add to CLAUDE.md published packages list
- Create changeset: `@sweny-ai/core` major — "Initial v3 release: skills + DAG workflow orchestration"

### 2. Deprecate old packages
For each of `engine`, `providers`, `agent`:
- Add deprecation notice to package.json `description`
- Create changeset marking as deprecated (patch bump with deprecation note)
- Add `"deprecated": "Use @sweny-ai/core instead"` to package.json if supported
- The actual `npm deprecate` command will be run post-publish

### 3. Update root README.md
- Point users to `@sweny-ai/core` instead of engine+providers
- Brief migration guide section

### 4. Update CLAUDE.md
- Add `@sweny-ai/core` to published packages table
- Note engine/providers/agent as deprecated

### 5. Create changeset for studio
- `@sweny-ai/studio` major bump (v9.0.0) — now depends on `@sweny-ai/core` instead of `@sweny-ai/engine`

### 6. CLI package
- If `packages/cli` imports from engine/providers, update to core
- Bump CLI version

## Files to modify
- `packages/core/package.json` (EDIT version)
- `packages/engine/package.json` (EDIT deprecation)
- `packages/providers/package.json` (EDIT deprecation)
- `packages/agent/package.json` (EDIT deprecation)
- `packages/studio/package.json` (EDIT version)
- `.changeset/v3-core-release.md` (CREATE)
- `.changeset/deprecate-old-packages.md` (CREATE)
- `CLAUDE.md` (EDIT)
- `README.md` (EDIT)

## Acceptance criteria
- `@sweny-ai/core` is version 3.0.0
- Old packages have deprecation notices
- Changesets exist for all version bumps
- CLAUDE.md and README.md reflect the new architecture
