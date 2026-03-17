# Issues Report — 2026-03-17

## Issue 1: Prettier Format Violations Block CI on Main

- **Severity**: High (CI is broken — no PRs can merge)
- **Environment**: CI
- **Frequency**: Recurring — at least 4 CI failures on main on 2026-03-17

### Description

6 source files were committed without Prettier formatting, causing `format:check` in CI
to exit with code 1 and block all merges to main.

### Evidence

From CI run `23199468449`:
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

### Root Cause Analysis

Files were added/modified in commits without running Prettier locally. The project has no
pre-commit hook enforcing format, so violations reach CI.

### Impact

- All CI runs on main fail at the Format step
- The Continuous Improvement workflow also fails (it depends on the CI workflow)
- Dependabot PRs fail CI too (Prettier check runs on all branches)

### Suggested Fix

Run `npx prettier --write` on all 6 offending files. **This fix has been applied.**

### Files Modified

- `packages/action/tests/mapToTriageConfig.test.ts`
- `packages/providers/src/coding-agent/claude-code.ts`
- `packages/providers/src/coding-agent/google-gemini.ts`
- `packages/providers/src/coding-agent/openai-codex.ts`
- `packages/providers/src/source-control/github.ts`
- `packages/providers/src/source-control/gitlab.ts`

### Confidence Level

High — direct CI log evidence, mechanical fix, verified clean after applying.

### GitHub Issues Status

No existing GitHub Issues issue found — new issue will be created.
