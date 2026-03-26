# Issues Report — 2026-03-26

## Issue 1: picomatch ReDoS Vulnerability (HIGH)

- **Severity**: High (CVSS 7.5)
- **Environment**: All (build, dev, CI)
- **Frequency**: Persistent — all 4 installed instances are vulnerable

### Description

picomatch, the glob-matching library used by Vite, Rollup, Astro, chokidar/anymatch, micromatch,
and tailwindcss, has a ReDoS (Regular Expression Denial of Service) vulnerability via extglob
quantifiers in crafted patterns. GHSA-c2c7-rcm5-vvqj, CVSS 7.5.

### Evidence

npm audit output:
- `node_modules/picomatch` → 4.0.3, vulnerable range `>=4.0.0 <4.0.4`
- `node_modules/anymatch/node_modules/picomatch` → 2.3.1, vulnerable range `<2.3.2`
- `node_modules/micromatch/node_modules/picomatch` → 2.3.1 (dev)
- `node_modules/tailwindcss/node_modules/picomatch` → 2.3.1 (dev)

### Root Cause Analysis

npm only installs versions satisfying declared semver ranges. picomatch@4.0.3 satisfies `^4.0.2`
(used by Vite/Rollup). picomatch@2.3.1 satisfies `^2.3.1` (micromatch), `^2.0.4` (anymatch),
`^2.2.1` (readdirp). None of these ranges pin to a fixed minimum that excludes the vulnerable
versions. The advisory was published after these lockfile entries were generated.

### Impact

ReDoS via crafted glob patterns. Primarily in development tooling (build, watch, lint) rather than
published package runtime. The astro/unstorage → anymatch chain is in the web docs package (private).
Production published packages (@sweny-ai/*) do not include picomatch as a runtime dep.

### Suggested Fix

Add npm `overrides` in root `package.json`:
```json
"picomatch": "^4.0.4",
"anymatch": { "picomatch": "^2.3.2" },
"micromatch": { "picomatch": "^2.3.2" },
"readdirp": { "picomatch": "^2.3.2" }
```

Then run `npm install --package-lock-only` to regenerate the lockfile.

### Files to Modify
- `package.json` (overrides)
- `package-lock.json` (regenerated)

### Confidence Level: High
### GitHub Issues Status: No existing GitHub Issues issue found

---

## Issue 2: fast-xml-parser Entity Expansion Bypass (MODERATE) — Companion Fix

- **Severity**: Moderate (CVSS 5.9)
- **Environment**: All (transitive via AWS SDK and other packages)
- **Frequency**: Persistent

### Description

A NEW advisory GHSA-jp2q-39xq-3w4g affects fast-xml-parser `>=4.0.0-beta.3 <=5.5.6`:
Entity expansion limits are bypassed when the limit is set to zero due to JavaScript falsy
evaluation. This is DIFFERENT from the advisory fixed by PR #76 (AWS SDK DoS).

The existing override `"fast-xml-parser": "^5.5.6"` resolves to version 5.5.6, which is still
within the vulnerable range. Fixed in 5.5.7+; latest is 5.5.9.

### Suggested Fix

Bump override from `"^5.5.6"` to `">=5.5.7"` in both `overrides` and `devDependencies`.

### GitHub Issues Status: No existing GitHub Issues issue found
