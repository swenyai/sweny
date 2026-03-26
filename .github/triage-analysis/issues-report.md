# Issues Report — 2026-03-24

## Issue 1: Auth Middleware Null Guard Missing on userId Access

- **Severity**: P2
- **Environment**: Production
- **Frequency**: 2 occurrences in log window (3+ total per LOCAL-2)
- **Description**: `TypeError: Cannot read properties of undefined (reading 'userId')` at `/app/src/handlers/user.ts:42`. Missing null guard on decoded JWT causes 500s instead of 401s on authenticated routes.
- **Evidence**: 2 error entries in `/tmp/ci-failures.json` with traceIds `abc123`, `abc124`
- **Root Cause**: `decodedToken.userId` access without null check when JWT verification returns falsy value
- **Impact**: All authenticated API routes return 500 instead of 401 for invalid/expired tokens
- **Suggested Fix**: Add `if (!decodedToken)` guard before `.userId` access, return 401
- **Files to Modify**: External `api` service — `/src/middleware/auth.ts` or `/src/handlers/user.ts`
- **Confidence**: High (exact match to LOCAL-2)
- **Issue Tracker Status**: Already tracked as **LOCAL-2** (open, P2)

---

## Issue 2: Database Connection Timeout

- **Severity**: P3
- **Environment**: Production
- **Frequency**: 1 occurrence
- **Description**: `UnhandledPromiseRejection: Database connection timeout after 5000ms` from the `api` service
- **Evidence**: 1 error entry in `/tmp/ci-failures.json` with traceId `def456`
- **Root Cause**: Cannot determine — no database client exists in this repo. The `api` service is external.
- **Impact**: Low — single occurrence, likely transient
- **Suggested Fix**: N/A for this repo. The `api` service owner should add connection retry logic and proper timeout handling.
- **Files to Modify**: None in this repo
- **Confidence**: Low (external service)
- **Issue Tracker Status**: No existing issue found — not actionable in this repo

---

## Issue 3: Auto-Changeset Workflow Creates Stale PR Accumulation

- **Severity**: P3
- **Environment**: CI/CD
- **Frequency**: Every push to main that touches published package source (7 stale PRs in 4 days)
- **Description**: The `auto-changeset.yml` workflow creates a new branch and PR on every qualifying push to main. It never closes or supersedes previous auto-changeset PRs, causing unbounded PR accumulation. Currently 7 stale PRs open (PRs #80-#86).
- **Evidence**: `gh pr list --author "app/github-actions"` shows 7 identical "chore(changeset): auto-generated changeset" PRs
- **Root Cause**: The workflow uses `auto-changeset/${{ github.sha }}` as the branch name (unique per commit), and the PR creation step has no logic to close previous auto-changeset PRs.
- **Impact**: PR list clutter, potential confusion about which changeset PR to merge, wasted GitHub Actions minutes
- **Suggested Fix**: Add a step to close existing auto-changeset PRs before creating a new one
- **Files to Modify**: `.github/workflows/auto-changeset.yml`
- **Confidence**: Very high — clear workflow logic gap, straightforward fix
- **Issue Tracker Status**: No existing issue found — new issue

---

## Issue 4: Dependabot PRs Failing CI (Typecheck)

- **Severity**: P3
- **Environment**: CI
- **Frequency**: All 9 open dependabot PRs affected
- **Description**: All dependabot PRs fail the Typecheck job with `TS2307: Cannot find module '@sweny-ai/shared'`. These branches were created before commit `39d95b9` added the `Build shared` step to CI.
- **Evidence**: CI run logs for runs 23469757789, 23469686217, 23469684783 all show same error
- **Root Cause**: Dependabot branches have stale `ci.yml` without the `Build shared` step
- **Impact**: Dependency updates blocked until branches are rebased
- **Suggested Fix**: Rebase dependabot branches on main (or close and let dependabot recreate)
- **Files to Modify**: None — already fixed on main
- **Confidence**: Very high
- **Issue Tracker Status**: No existing issue — operational, not a code bug
