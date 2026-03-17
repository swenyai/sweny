<!-- TRIAGE_FINGERPRINT
error_pattern: Code style issues found in 6 files. Run Prettier with --write to fix.
service: sweny-ci
first_seen: 2026-03-17
run_id: 23199468449
-->

RECOMMENDATION: implement

TARGET_SERVICE: sweny-ci
TARGET_REPO: swenyai/sweny

**GitHub Issues Issue**: None found - New issue will be created

# Prettier Format Violations Break CI on Main

## Summary

6 files were committed without Prettier formatting, breaking the `format:check` CI step
on every push to main. This prevents any PR from merging until fixed.

## Root Cause

The `format:check` CI step runs `prettier --check .`. The following files did not conform
to the project's Prettier config:

- `packages/action/tests/mapToTriageConfig.test.ts`
- `packages/providers/src/coding-agent/claude-code.ts`
- `packages/providers/src/coding-agent/google-gemini.ts`
- `packages/providers/src/coding-agent/openai-codex.ts`
- `packages/providers/src/source-control/github.ts`
- `packages/providers/src/source-control/gitlab.ts`

No pre-commit hook exists to catch this locally, so violations reached CI.

## Evidence

CI run `23199468449` (main, 2026-03-17):
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

Same failure repeated in runs: 23195029818, 23195412282, 23195001538.

## Fix Applied

Ran `npx prettier --write` on all 6 files. Verified with `npx prettier --check` — all clean.

## Files Modified

| File | Package | Published |
|------|---------|-----------|
| `packages/action/tests/mapToTriageConfig.test.ts` | `@sweny-ai/action` | No (private) |
| `packages/providers/src/coding-agent/claude-code.ts` | `@sweny-ai/providers` | Yes |
| `packages/providers/src/coding-agent/google-gemini.ts` | `@sweny-ai/providers` | Yes |
| `packages/providers/src/coding-agent/openai-codex.ts` | `@sweny-ai/providers` | Yes |
| `packages/providers/src/source-control/github.ts` | `@sweny-ai/providers` | Yes |
| `packages/providers/src/source-control/gitlab.ts` | `@sweny-ai/providers` | Yes |

## Changeset

`@sweny-ai/providers` patch bump — formatting-only, no behavioral change.

## Test Plan

- [ ] `npm run format:check` passes
- [ ] `npm test` passes (no regressions in source-control or coding-agent tests)

## Rollback Plan

Formatting changes are purely cosmetic. If needed, revert the commit. The only effect of
reverting is CI fails the format check again.

## Confidence

High. Direct evidence from CI logs. Mechanical Prettier fix — no logic changes.
