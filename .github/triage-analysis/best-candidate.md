<!-- TRIAGE_FINGERPRINT
error_pattern: h3 <=1.15.5 SSE Injection and Path Traversal via unstorage transitive dependency
service: sweny-deps
first_seen: 2026-03-19
run_id: 23222880779
-->

RECOMMENDATION: implement

TARGET_SERVICE: sweny-deps
TARGET_REPO: swenyai/sweny

**GitHub Issues Issue**: None found - New issue will be created

# h3 HIGH severity vulnerability via astro transitive dependency

## Summary

h3 `<= 1.15.5` in the root lockfile (Dependabot alerts #32 HIGH and #31 MEDIUM) is fixed by
adding `"h3": "^1.15.6"` to npm `overrides` in root `package.json` and running `npm audit fix`.
h3 is now resolved to 1.15.8 in `package-lock.json`.

## Root Cause

`packages/web` → `astro@^5.6.1` → `unstorage@1.17.4` → `h3@^1.15.5`

npm resolved `h3@^1.15.5` to 1.15.5 (the minimum), which is below the patched version 1.15.6.
No root-level override existed to force a higher resolution.

## CVEs Resolved

| Alert | GHSA | Severity | Summary |
|-------|------|----------|---------|
| #32 | GHSA-22cc-p3c6-wpvm | HIGH | SSE Injection via unsanitized newlines in `createEventStream()` |
| #31 | GHSA-wr4h-v87w-p3r7 | MEDIUM | Path Traversal via percent-encoded dots in `serveStatic` |

## Exact Code Changes

**`package.json`** — added `h3` override:

```diff
   "overrides": {
     "svgo": "^4.0.1",
-    "fast-xml-parser": "^5.5.6"
+    "fast-xml-parser": "^5.5.6",
+    "h3": "^1.15.6"
   },
```

**`package-lock.json`** — h3 upgraded from 1.15.5 to 1.15.8 (via `npm audit fix`).

## Changeset Required

No — this is a root-level dependency configuration change. No published package (`@sweny-ai/*`)
changes its API surface or runtime behavior. Per CLAUDE.md:
> You may omit a changeset for: Root-level doc/config changes that don't affect package consumers

## Test Plan

1. `npm_config_ignore_scripts=true npm audit` — confirm 0 high/critical vulnerabilities
2. `npm run test --workspaces --if-present` — confirm no tests broken by h3 version bump
3. `npm run build:web` — confirm `packages/web` still builds with updated h3

## Rollback Plan

Revert the one-line addition to `package.json` `overrides` and re-run `npm install`.
h3 would return to 1.15.5 (vulnerable). Risk is minimal — h3 is only used in dev server
context via astro/unstorage, not in any published package runtime path.

## Impact

- Resolves 1 HIGH + 1 MEDIUM Dependabot security alert (alerts #32 and #31)
- No API surface changes, no published package changes
- Consistent with prior security fix pattern (PR #76 — fast-xml-parser override)

## Confidence

High — npm audit confirms h3@1.15.8 resolves both CVEs. Override pattern is established in this repo.
