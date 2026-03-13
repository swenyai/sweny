<!-- TRIAGE_FINGERPRINT
error_pattern: TypeError: Cannot read properties of undefined (reading 'userId') at auth.ts:42
service: api-gateway
first_seen: 2026-03-12
run_id: direct-run-2026-03-12
-->

RECOMMENDATION: implement

TARGET_SERVICE: api-gateway
TARGET_REPO: swenyai/sweny

**Issue Tracker Issue**: None found - New issue will be created

# Auth Middleware Null Guard Missing on userId Access

## Summary

`AuthMiddleware.verify` at `auth.ts:42` crashes with a TypeError when the decoded JWT/session
object is `undefined`. This produces 500s on all authenticated routes instead of the correct
401/403. The error appeared 3 times in 24h across profile, settings, and orders endpoints.

## Root Cause

Line 42 of `auth.ts` accesses `.userId` directly without a null guard:

```typescript
// Current (crashes when decodedToken is undefined/null):
const userId = decodedToken.userId;
```

When `jwt.verify()` returns a falsy value (e.g., on an invalid or expired token in some
library configurations) instead of throwing, the subsequent property access throws an
unhandled TypeError that bubbles up as a 500.

## Exact Code Change

**File**: `/src/middleware/auth.ts`, line ~42

```typescript
// Before:
const userId = decodedToken.userId;

// After:
if (!decodedToken) {
  return next(new UnauthorizedError('Invalid or missing authentication token'));
}
const userId = decodedToken.userId;
```

If the codebase uses `res.status()` directly instead of error middleware:

```typescript
// Alternative (express-style):
if (!decodedToken) {
  return res.status(401).json({ error: 'Unauthorized' });
}
const userId = decodedToken.userId;
```

The guard should be placed immediately before the `.userId` access (line 42) and should
return a 401, not a 500, to correctly signal an authentication failure.

## Evidence

```
TypeError: Cannot read properties of undefined (reading 'userId')
    at AuthMiddleware.verify (/src/middleware/auth.ts:42:28)
    at processRequest (/src/server.ts:118:5)

Affected requests (24h):
  GET  /api/v1/users/profile   -> 500  (req_abc123)
  GET  /api/v1/users/settings  -> 500  (req_def456)
  POST /api/v1/orders          -> 500  (req_ghi789)
```

## Files to Modify

- `/src/middleware/auth.ts` — add null guard at line ~42 before `decodedToken.userId` access

## Test Plan

- [ ] Send a request with an intentionally malformed JWT — expect 401, not 500
- [ ] Send a request with no Authorization header — expect 401
- [ ] Send a request with a valid JWT — expect normal response (auth passes through)
- [ ] Send a request with an expired JWT — expect 401
- [ ] Confirm no new TypeErrors appear in error logs after deploy

## Rollback Plan

The change is additive (only adds a guard before existing logic). If the guard introduces
unexpected behavior, revert by removing the `if (!decodedToken)` block. The underlying crash
will return but without causing regressions in other paths.

## Confidence

High. Stack trace pinpoints the exact line; the fix is a single null guard — minimal blast
radius, standard defensive pattern, fully reversible.

## Note on Service Map

`.github/service-map.yml` was not found in this repository. The `api-gateway` service
referenced in the logs could not be matched to a specific repo. TARGET_REPO is set to
the current repo (`swenyai/sweny`) as a fallback. If `api-gateway` lives in a different
repository, this issue should be dispatched there once the service map is created.
