# Investigation Log — 2026-03-17

## Approach

Additional instructions direct improvement of the SWEny codebase itself.
Primary inputs: CI failure logs at `/tmp/ci-failures.json` + holistic codebase review.

## Step 1: Read CI Failure Log

`/tmp/ci-failures.json` contains 20 entries, all from 2026-03-17.

Workflows failing:
- **CI on main** (run IDs: 23199468449, 23195029818) — repeated failures
- **Continuous Improvement on main** (run IDs: 23195412282, 23195001538)
- **CI on dependabot branches** — multiple dependency update branches

## Step 2: Inspect Most Recent Failure

Fetched logs for run `23199468449` (most recent CI failure on main).

**Failure step**: `Format — Run npm run format:check`

```
[warn] packages/action/tests/mapToTriageConfig.test.ts
[warn] packages/providers/src/coding-agent/claude-code.ts
[warn] packages/providers/src/coding-agent/google-gemini.ts
[warn] packages/providers/src/coding-agent/openai-codex.ts
[warn] packages/providers/src/source-control/github.ts
[warn] packages/providers/src/source-control/gitlab.ts
[error] Code style issues found in 6 files. Run Prettier with --write to fix.
Process completed with exit code 1.
```

## Step 3: Root Cause Analysis

6 files were committed without running Prettier first. The `format:check` step in CI runs
`prettier --check .` and fails the build when files don't conform to the project's formatting
rules. These were likely new files added or modified in recent commits without running the
formatter locally.

## Step 4: Fix Applied

Ran `npx prettier --write` on all 6 offending files:
- `packages/action/tests/mapToTriageConfig.test.ts`
- `packages/providers/src/coding-agent/claude-code.ts`
- `packages/providers/src/coding-agent/google-gemini.ts`
- `packages/providers/src/coding-agent/openai-codex.ts`
- `packages/providers/src/source-control/github.ts`
- `packages/providers/src/source-control/gitlab.ts`

Verified clean with `npx prettier --check` — all files now pass.

## Step 5: Known Issues Cross-Check

- PR #61 (open): newrelic/sentry config schemas — confirmed already committed (`7bd135a`); PR still open but fix is in main. Not related to this CI failure.
- PR #44, #32, #34: closed, not re-introduced by this change.

## Step 6: Changeset

Files modified are in:
- `packages/action` (private, not published) — no changeset needed
- `packages/providers` (published as `@sweny-ai/providers`) — formatting-only = patch
- `packages/providers/src/source-control/` and `packages/providers/src/coding-agent/` are published

Created `.changeset/fix-prettier-format-violations.md` (patch).
