# Investigation Log — 2026-03-24

## Parameters
- Service Pattern: `*`
- Time Range: 7d
- Focus Area: errors
- Investigation Depth: thorough

## Step 1: Read log file (`/tmp/ci-failures.json`)

3 entries total:
- 2x `TypeError: Cannot read properties of undefined (reading 'userId')` — service: api, env: production
- 1x `UnhandledPromiseRejection: Database connection timeout after 5000ms` — service: api, env: production

## Step 2: Cross-reference with known issues

- **LOCAL-1** (CLI Typecheck Failures): Searched codebase for `triageRecipe.nodes` — **no matches found**. The fix appears to have already been applied to the codebase. Issue still marked open.
- **LOCAL-2** (Auth Middleware Null Guard): The 2x userId TypeError errors match this issue exactly (same error pattern, same service). Already tracked.

## Step 3: Investigate database connection timeout

- Searched entire codebase for database client code (pg, mysql, prisma, drizzle, knex, etc.) — **none found**
- The only 5000ms timeout in the codebase is in `packages/providers/src/observability/fly.ts` (HTTP fetch timeout), not a database connection
- The worker's Redis/BullMQ connection (`packages/worker/src/index.ts:94`) uses library defaults with no explicit timeout
- `packages/worker/Dockerfile` explicitly states: "No direct database access required"
- Conclusion: The "api" service in the logs is external to this repo. This repo is a toolkit/SDK monorepo, not an API service.

## Step 4: Check Sentry for production errors

- Found Sentry org: `offload-pw` (region: `us.sentry.io`)
- Queried for unresolved errors from last 7 days: **no issues found**

## Step 5: Investigate CI failures

Checked recent GitHub Actions runs:
- **Main branch CI (run 23498008798)**: All jobs pass (Lint, Format, Typecheck, Test Node 20/22, Smoke)
- **5 dependabot PRs failing**: All fail with `TS2307: Cannot find module '@sweny-ai/shared'` in the Typecheck job
  - Root cause: These branches were created before commit `39d95b9` which added the `Build shared` step to CI
  - All dependabot branches have the old `ci.yml` without the `Build shared` step
  - Resolution: Rebasing these branches on main will pick up the fix
  - Worker imports are all `import type` (erased at runtime), so the test job passes fine

## Step 6: Investigate auto-changeset PR accumulation

Found **7 stale auto-changeset PRs** (PRs #80-#86) all with identical titles.

Root cause: `.github/workflows/auto-changeset.yml` creates a new branch and PR on every push to main that touches published package source code. It:
1. Uses `auto-changeset/${{ github.sha }}` as the branch name (unique per push)
2. Never checks for existing open auto-changeset PRs
3. Never closes previous auto-changeset PRs

This causes unbounded PR accumulation. Each PR supersedes the previous one (since the script recalculates from the last release), making all but the newest one obsolete.

## Step 7: Service map

No `.github/service-map.yml` exists in this repository. All TARGET_REPO assignments default to `swenyai/sweny`.

## Summary of findings

| # | Issue | Status | Severity | Actionable? |
|---|-------|--------|----------|-------------|
| 1 | userId TypeError (auth null guard) | Known (LOCAL-2) | P2 | +1 existing |
| 2 | DB connection timeout | External service | Low | Skip (not in this repo) |
| 3 | Auto-changeset PR accumulation | **New** | P3 | **Yes — workflow fix** |
| 4 | Dependabot PRs blocked | Operational | P3 | Rebase needed |
| 5 | LOCAL-1 possibly already fixed | Needs verification | P4 | Close if confirmed |
