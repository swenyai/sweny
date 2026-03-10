# SWEny Monorepo — Claude Instructions

## Changesets (REQUIRED)

This project uses [Changesets](https://github.com/changesets/changesets) for automated SemVer versioning and npm publishing.

**Any time you modify source files in a published package, you MUST create a changeset file before committing.**

Published packages:
- `packages/engine` → `@sweny-ai/engine`
- `packages/studio` → `@sweny-ai/studio`
- `packages/cli` → `@sweny-ai/cli`
- `packages/providers` → `@sweny-ai/providers`
- `packages/agent` → `@sweny-ai/agent`

### How to create a changeset

Create a file at `.changeset/<descriptive-slug>.md`:

```md
---
"@sweny-ai/engine": minor
"@sweny-ai/cli": patch
---

Brief description of what changed and why — written for package consumers.
```

Bump level rules:
- `major` — breaking API change (removed export, changed signature, renamed type)
- `minor` — new feature, new export, new option (backwards compatible)
- `patch` — bug fix, internal refactor, performance improvement, docs only

You may omit a changeset for:
- Changes to `packages/web`, `packages/action` (private, not published)
- CI/workflow-only changes (`.github/`, `scripts/`)
- Root-level doc/config changes that don't affect package consumers
- Commits that already have a changeset in the same batch

### CI backstop

`scripts/auto-changeset.mjs` runs in CI on every push to main and auto-generates a changeset for any published package that has unreleased commits but no pending changeset. This is a fallback — prefer creating changesets explicitly with the correct bump level and a meaningful description.

## Release flow

1. Merge feature work to `main` (with changeset files included)
2. Changesets action opens PR #N "chore: release packages" — shows computed version bumps
3. Merge that PR → packages publish to npm automatically

## Package structure

| Package | Dir | Published |
|---------|-----|-----------|
| `@sweny-ai/engine` | `packages/engine` | yes |
| `@sweny-ai/studio` | `packages/studio` | yes |
| `@sweny-ai/cli` | `packages/cli` | yes |
| `@sweny-ai/providers` | `packages/providers` | yes |
| `@sweny-ai/agent` | `packages/agent` | yes |
| `@sweny-ai/action` | `packages/action` | no (private) |
| `@sweny-ai/web` | `packages/web` | no (private) |

## Test framework

Both Vitest 4, ESM (`"type": "module"`). Run tests with `npm test`.

## Studio library build

The studio package has two build targets:
- `npm run build` — SPA at `dist/` (for `npm run dev:studio`)
- `npm run build:lib` — library at `dist-lib/` (for `@sweny-ai/studio/viewer` and `@sweny-ai/studio/editor`)

The Deploy Docs workflow runs `build:lib` before the web build.
