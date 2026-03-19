# Issues Report — 2026-03-19

## Issue 1: h3 HIGH/MEDIUM Vulnerabilities via astro → unstorage Dependency

- **Severity**: High (alert #32) + Medium (alert #31)
- **Environment**: All environments (root lockfile, affects anyone running `npm install`)
- **Frequency**: Present since astro pulled unstorage@1.17.4 with h3@^1.15.5 pinning

### Description

h3 version 1.15.5 is present in the lockfile as a transitive dependency:
`packages/web` → `astro@^5.6.1` → `unstorage@1.17.4` → `h3@1.15.5`

h3 <= 1.15.5 has two known vulnerabilities:
1. **HIGH**: SSE Injection via unsanitized newlines in `createEventStream()` — attacker controlling any SSE field (`id`, `event`, `data`) can inject arbitrary events to connected clients.
2. **MEDIUM**: Path Traversal via percent-encoded dot segments in `serveStatic` — allows arbitrary file read.

### Evidence

- Dependabot alert #32: GHSA-22cc-p3c6-wpvm (SSE Injection, HIGH)
- Dependabot alert #31: GHSA-wr4h-v87w-p3r7 (Path Traversal, MEDIUM)
- `grep "node_modules/h3" package-lock.json` → `"version": "1.15.5"` (vulnerable)
- `npm audit` confirmed both CVEs before fix

### Root Cause Analysis

`unstorage@1.17.4` specifies `"h3": "^1.15.5"` as a dependency. npm resolved this to 1.15.5
(the minimum), which is below the patched version 1.15.6. No root-level override was present.

### Impact

- h3 SSE functionality is used internally by unstorage/astro dev server.
- Path traversal affects `serveStatic` usage in h3-based servers.
- `packages/web` is private and not published to npm, so no consumer impact via the registry.
  However, the vulnerability is present in developer environments and CI.

### Fix Applied

Added `"h3": "^1.15.6"` to root `overrides` in `package.json`, then ran `npm audit fix`
to upgrade h3 from 1.15.5 to 1.15.8 in `package-lock.json`.

### Files Modified

- `package.json` — added `"h3": "^1.15.6"` to `overrides`
- `package-lock.json` — regenerated with h3@1.15.8

### Confidence Level

High — npm audit confirms resolution. Pattern matches the established PR #76 fix for fast-xml-parser.

### GitHub Issues Status

No existing GitHub Issues issue found — New issue will be created.

---

## Issue 2: esbuild Dev Server Vulnerability in packages/studio (Known Limitation)

- **Severity**: Medium
- **Environment**: Development only (Vite dev server)
- **Frequency**: Ongoing (Dependabot alert #21)

### Description

`packages/studio/node_modules/esbuild` (via vite) is at version 0.24.x (≤ 0.24.2).
Esbuild ≤ 0.24.2 allows any website to send requests to the local dev server.
This is a development-only risk (dev server binding).

### Fix Assessment

`npm audit fix --force` would install vite@8.0.1 — a major breaking change.
The root-level esbuild is already at 0.27.3 (patched). The vulnerable instance is scoped
to vite's local install. Fixing requires a vite major version upgrade — out of scope for
a targeted security patch. Tracked separately.

### GitHub Issues Status

No existing GitHub Issues issue found — tracked as a separate future upgrade.
