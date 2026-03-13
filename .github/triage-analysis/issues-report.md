# Issues Report — 2026-03-12

## Issue 1: Auth Middleware Null Guard Missing — userId Access on Undefined

- **Severity**: Critical
- **Environment**: Production
- **Frequency**: 3 occurrences in 24h window — all user-facing endpoints returning 500

### Description

`AuthMiddleware.verify` at `/src/middleware/auth.ts:42` reads `.userId` from an object
(decoded JWT or session) without first checking whether it is defined. When the object is
`undefined` (e.g., malformed token, expired session, missing Authorization header edge case),
the middleware throws an unhandled TypeError that propagates as a 500 to the client.

### Evidence

```
TypeError: Cannot read properties of undefined (reading 'userId')
    at AuthMiddleware.verify (/src/middleware/auth.ts:42:28)
    at processRequest (/src/server.ts:118:5)
```

- `GET /api/v1/users/profile` → 500 (req_abc123)
- `GET /api/v1/users/settings` → 500 (req_def456)
- `POST /api/v1/orders` → 500 (req_ghi789)

### Root Cause Analysis

Line 42 of `auth.ts` performs a direct property access (`decodedToken.userId` or similar)
without guarding against a nullish `decodedToken`. When JWT verification returns `undefined`
or `null` instead of throwing (e.g., `jwt.verify` with `complete: false` returning null on
an invalid token in some library versions), the subsequent property access crashes.

### Impact

- All authenticated routes are susceptible: 500s instead of 401/403 for invalid tokens
- Users with edge-case token states (e.g., transitioning between sessions) get opaque errors
- No differentiation between "invalid token" (should be 401) and server error (500)

### Suggested Fix

```typescript
// auth.ts line 42 (approximate, before userId access):
if (!decodedToken) {
  throw new UnauthorizedError('Invalid or missing authentication token');
}
const userId = decodedToken.userId;
```

Or, if the function returns early instead of throwing:
```typescript
if (!decodedToken || !decodedToken.userId) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### Files to Modify

- `/src/middleware/auth.ts` — line ~42, add null guard before `.userId` access

### Confidence Level

High — direct stack trace pinpoints the exact line; the fix pattern is standard defensive programming.

### Issue Tracker Status

No existing Issue Tracker issue found — new issue will be created.

---

## Issue 2: Worker — PostgreSQL ECONNREFUSED (Infrastructure)

- **Severity**: High
- **Environment**: Production
- **Frequency**: 2 occurrences in 24h window

### Description

Two worker jobs failed immediately with `ECONNREFUSED 127.0.0.1:5432` (PostgreSQL).
Both jobs had `retry_count: 0`, suggesting no retry policy is in place for connection errors.

### Evidence

```
Job processing failed: ECONNREFUSED 127.0.0.1:5432 - Connection refused to PostgreSQL
  job_id: job_abc, job_type: send_notification
  job_id: job_def, job_type: process_payment
```

### Root Cause Analysis

Primary cause is likely infrastructure (PostgreSQL instance unavailable at localhost).
Secondary code issue: the worker makes no retry attempt on `ECONNREFUSED` — jobs fail
immediately. A connection error is typically transient and should trigger retries.

### Impact

Notifications and payment processing jobs silently dropped.

### Suggested Fix

1. (Infrastructure) Ensure PostgreSQL is accessible and healthy.
2. (Code) Add retry-with-backoff for `ECONNREFUSED` before marking the job failed.

### Confidence Level

Medium for infrastructure cause, high for the missing retry policy.

### Issue Tracker Status

No existing Issue Tracker issue found.

---

## Issue 3: Payment Service — Stripe Webhook Signature Mismatch

- **Severity**: Medium
- **Environment**: Production
- **Frequency**: 1 occurrence in 24h window

### Description

Stripe webhook signature verification failed for event `evt_1234567890` on `/webhooks/stripe`.

### Evidence

```
Stripe webhook signature verification failed: No signatures found matching the expected signature
  webhook_id: evt_1234567890, status_code: 400
```

### Root Cause Analysis

Most likely cause: webhook signing secret was rotated in the Stripe dashboard but the
environment variable `STRIPE_WEBHOOK_SECRET` in the payment service was not updated.

### Impact

Stripe events (payment confirmations, refunds, disputes) are not being processed.

### Suggested Fix

Rotate / resync `STRIPE_WEBHOOK_SECRET` env var to match the current secret in Stripe dashboard.

### Confidence Level

Medium — single occurrence, may be a one-time replay or key rotation event.

### Issue Tracker Status

No existing Issue Tracker issue found.
