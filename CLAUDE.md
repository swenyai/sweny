# SWEny Monorepo — Claude Instructions

## Deployment

Push to `main` auto-deploys everything:
1. `.github/workflows/release.yml` rebuilds `dist/`, bumps versions, publishes to npm, and updates the `v4` action tag
2. GitHub Action consumers (`swenyai/sweny@v4`) pick up changes on their next run — no manual release step

Changesets are handled by a CI backstop (`scripts/auto-changeset.mjs`) that auto-generates one for any published package with unreleased commits. You can also create one explicitly at `.changeset/<slug>.md` with the correct bump level if you want a meaningful description.

## Package structure

| Package | Dir | Published | Notes |
|---------|-----|-----------|-------|
| `@sweny-ai/core` | `packages/core` | npm | v4 — skills + DAG executor |
| `@sweny-ai/studio` | `packages/studio` | npm | Visual workflow viewer/editor |
| `@sweny-ai/action` | `packages/action` | no (private) | GitHub Action entrypoint — bundled into root `dist/` |
| `@sweny-ai/web` | `packages/web` | no (private) | Docs site |

## Test framework

Both Vitest 4, ESM (`"type": "module"`). Run tests with `npm test`.

## Studio library build

The studio package has two build targets:
- `npm run build` — SPA at `dist/` (for `npm run dev:studio`)
- `npm run build:lib` — library at `dist-lib/` (for `@sweny-ai/studio/viewer` and `@sweny-ai/studio/editor`)

The Deploy Docs workflow runs `build:lib` before the web build.
