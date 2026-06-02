# SWEny Monorepo — Claude Instructions

## Deployment

Push to `main` auto-deploys everything:
1. `.github/workflows/release.yml` builds the publishable packages (`core`, `studio` lib, `mcp`, `create-sweny`), bumps versions, publishes to npm, and moves the `v5` action tag (the action is the composite root `action.yml`, no JS bundle)
2. GitHub Action consumers (`swenyai/sweny@v5`) pick up changes on their next run — no manual release step
3. Vercel auto-deploys `packages/web` (docs.sweny.ai) and `spec/` (spec.sweny.ai) on push to `main`

There are no changesets. `release.yml` versions and publishes directly: it diffs each publishable package (`core`, `studio`, `mcp`, `create-sweny`) against the `release-latest` tag, and for any that changed it runs `bump_and_publish`. That picks the version from `max(local package.json, npm)` and publishes it (cutting a patch above npm when the local version is stale or already taken). To ship a specific minor/major, set the version in the package's `package.json` ahead of npm. After publishing it pushes the `v5` and immutable `v5.<core-version>` tags.

## Package structure

| Package | Dir | Published | Notes |
|---------|-----|-----------|-------|
| `@sweny-ai/core` | `packages/core` | npm | v5 — skills + DAG executor + CLI |
| `create-sweny` | `packages/create-sweny` | npm | `npx create-sweny` — thin wrapper around `sweny new` |
| `@sweny-ai/studio` | `packages/studio` | npm | Visual workflow viewer/editor |
| `@sweny-ai/mcp` | `packages/mcp` | npm | MCP server for Claude Code / Desktop |
| — | `packages/plugin` | no (marketplace) | Claude Code plugin: skills, MCP tools, agent, hooks |
| (composite) | `action.yml` (repo root) | no (private) | GitHub Action entrypoint: a composite action that forwards to `sweny workflow run` (no JS bundle, no `dist/`) |
| `@sweny-ai/web` | `packages/web` | no (private) | Docs site (Vercel → docs.sweny.ai) |

## Test framework

Both Vitest 4, ESM (`"type": "module"`). Run tests with `npm test`.

## Studio library build

The studio package has two build targets:
- `npm run build` — SPA at `dist/` (for `npm run dev:studio`)
- `npm run build:lib` — library at `dist-lib/` (for `@sweny-ai/studio/viewer` and `@sweny-ai/studio/editor`)

Vercel's `buildCommand` in `packages/web/vercel.json` runs core → studio lib → web build.
