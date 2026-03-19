# Investigation Log — 2026-03-19

## Approach

Additional instructions: prioritize security advisories if no clear CI target.
CI failure log showed only generic "CI on main" / "Release on main" failures (no specific error detail — just run IDs).
Shifted to Dependabot security alerts as primary target.

## Step 1 — Parse CI failure log

Read `/tmp/ci-failures.json`. Failures observed (2026-03-17 to 2026-03-18):
- Multiple "CI on main" failures (run IDs: 23216459126, 23216453944, 23215201519, 23215136626)
- Multiple "Release on main" failures
- One "CI on 75" failure (run ID: 23222880779)

No specific error detail in log — only workflow names and run IDs.

## Step 2 — Fetch Dependabot security alerts

```
GET /repos/swenyai/sweny/dependabot/alerts?state=open
```

Result: 3 open alerts:
| # | Severity | Package | Summary | Patched |
|---|----------|---------|---------|---------|
| 32 | HIGH | h3 | SSE Injection via unsanitized newlines | >= 1.15.6 |
| 31 | MEDIUM | h3 | Path Traversal via percent-encoded dots in serveStatic | >= 1.15.6 |
| 21 | MEDIUM | esbuild | Dev server accepts cross-origin requests | >= 0.25.0 |

## Step 3 — Investigate h3 dependency chain

```bash
grep "node_modules/h3" package-lock.json
# → h3@1.15.5 (vulnerable)

# Find h3's direct dependents:
# → node_modules/unstorage: h3 ^1.15.5

# Find unstorage's dependents:
# → node_modules/astro: unstorage@^1.17.4

# Find which workspace uses astro:
find packages -name package.json | xargs grep -l "astro"
# → packages/web/package.json
```

Chain: `packages/web` (private) → `astro@^5.6.1` → `unstorage@1.17.4` → `h3@1.15.5` (vulnerable)

## Step 4 — Investigate esbuild

```bash
grep -A3 '"node_modules/esbuild"' package-lock.json
# → root esbuild@0.27.3 (already > 0.24.2, patched)
```

The vulnerable esbuild is `packages/studio/node_modules/esbuild` (scoped, via vite).
The npm audit reports a fix is available via `npm audit fix --force` which would install vite@8.0.1 — a major breaking change. Not suitable for a safe security patch.

## Step 5 — Apply h3 fix

Reviewed PR #76 (fast-xml-parser fix) for the established pattern: add to root `overrides` in package.json.

**Added** `"h3": "^1.15.6"` to root `overrides` section in `package.json`.

Ran:
```bash
npm_config_ignore_scripts=true npm install
# → h3 still at 1.15.5 (lockfile pinned)

npm_config_ignore_scripts=true npm audit fix
# → h3 upgraded to 1.15.8 ✓
```

## Step 6 — Final audit verification

```bash
npm_config_ignore_scripts=true npm audit
```

Result: h3 vulnerabilities resolved. Remaining:
- 2 moderate (esbuild in packages/studio via vite — requires breaking vite@8 upgrade, out of scope)

No changeset required: root-level package.json override + lockfile update only (no published package changes).
