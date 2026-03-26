<!-- TRIAGE_FINGERPRINT
error_pattern: picomatch ReDoS via extglob quantifiers GHSA-c2c7-rcm5-vvqj + fast-xml-parser entity expansion bypass GHSA-jp2q-39xq-3w4g
service: sweny-ci
first_seen: 2026-03-26
run_id: N/A (direct run)
-->

# picomatch ReDoS and fast-xml-parser Entity Expansion vulnerabilities via npm overrides

RECOMMENDATION: implement

**GitHub Issues Issue**: None found - New issue will be created

TARGET_SERVICE: sweny
TARGET_REPO: swenyai/sweny

## Summary

Two security vulnerabilities are present in the monorepo's dependency tree:

1. **picomatch** (HIGH, CVSS 7.5) — GHSA-c2c7-rcm5-vvqj: ReDoS via crafted extglob quantifiers.
   Four instances installed: `4.0.3` (top-level) and `2.3.1` (3 nested copies in anymatch,
   micromatch, tailwindcss/readdirp). Fixed in `4.0.4` and `2.3.2` respectively.

2. **fast-xml-parser** (MODERATE, CVSS 5.9) — GHSA-jp2q-39xq-3w4g: entity expansion limits
   bypassed when limit is zero (JavaScript falsy evaluation). Existing override pins to `^5.5.6`
   which resolves to `5.5.6` — still within the vulnerable range (`<=5.5.6`). Fixed in `5.5.7+`.
   This is a DIFFERENT advisory from the one addressed by PR #76.

## Technical Analysis

### picomatch

Current state in `package-lock.json`:
```
node_modules/picomatch                        → 4.0.3 (vulnerable: >=4.0.0 <4.0.4)
node_modules/anymatch/node_modules/picomatch  → 2.3.1 (vulnerable: <2.3.2)
node_modules/micromatch/node_modules/picomatch → 2.3.1 (dev, vulnerable)
node_modules/tailwindcss/node_modules/picomatch → 2.3.1 (dev, vulnerable)
```

Consumers of the 4.x instance: `astro`, `@rollup/pluginutils`, `@astrojs/react/node_modules/vite`,
`astro/node_modules/vite` — all declare `picomatch: ^4.0.2`, compatible with `4.0.4`.

Consumers of the 2.x instances:
- `anymatch` → `^2.0.4` (used by `unstorage` → `astro`)
- `micromatch` → `^2.3.1` (dev; used by `lint-staged`)
- `tailwindcss/node_modules/readdirp` → `^2.2.1`

Fix strategy: npm `overrides` with a top-level `"picomatch": "^4.0.4"` (fixes 4.x top-level) plus
nested overrides for the three 2.x consumers to prevent the top-level override from forcing them
to 4.x (which would be a breaking API change for those packages).

### fast-xml-parser

Current `package.json` overrides: `"fast-xml-parser": "^5.5.6"`.
`^5.5.6` resolves to exactly `5.5.6` (no patch releases above it in the `^` range at time of
last install). Advisory GHSA-jp2q-39xq-3w4g covers `>=4.0.0-beta.3 <=5.5.6`.
Latest available: `5.5.9`. Fix: change override to `>=5.5.7`.

## Exact Code Changes

### `package.json`

Change the `overrides` block and the `fast-xml-parser` devDependency:

```diff
   "overrides": {
     "svgo": "^4.0.1",
-    "fast-xml-parser": "^5.5.6"
+    "fast-xml-parser": ">=5.5.7",
+    "picomatch": "^4.0.4",
+    "anymatch": {
+      "picomatch": "^2.3.2"
+    },
+    "micromatch": {
+      "picomatch": "^2.3.2"
+    },
+    "readdirp": {
+      "picomatch": "^2.3.2"
+    }
   },
   "devDependencies": {
     "@changesets/cli": "^2.30.0",
-    "fast-xml-parser": "^5.5.6",
+    "fast-xml-parser": ">=5.5.7",
```

Then regenerate the lockfile:
```bash
npm install --package-lock-only
```

## Test Plan

1. After applying changes, run `npm audit` — picomatch and fast-xml-parser should no longer appear
   in the vulnerability report.
2. Run `npm run build --workspace=packages/providers` to verify providers still build.
3. Run `npm test` to verify tests pass.
4. CI will run the full typecheck and test suite on the PR.

## Rollback Plan

Revert `package.json` to the previous `overrides` block and re-run
`npm install --package-lock-only`. The changes are additive overrides only — no source code is
modified, making rollback trivial and risk-free.

## Risk Assessment

**Low risk.** The changes are:
- npm override additions only — no source code modifications
- Patch-only version bumps for all affected packages (2.3.1→2.3.2, 4.0.3→4.0.4, 5.5.6→5.5.9)
- No published package runtime code changes (picomatch and fast-xml-parser are not runtime deps
  of any @sweny-ai/* package)
- All declared semver ranges in dependents (`^4.0.2`, `^2.0.4`, `^2.3.1`, `^2.2.1`) are
  compatible with the bumped versions

## Files to Modify

- `package.json` — add picomatch overrides, bump fast-xml-parser
- `package-lock.json` — regenerated via `npm install --package-lock-only`
