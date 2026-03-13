# Investigation Log — 2026-03-12

## Approach

Default mode (no Issue Tracker issue, no additional instructions). Read local log file at
`packages/cli/fixtures/sample-errors.json` and investigate top errors by frequency and severity.

## Step 1 — Read log file

```bash
cat "packages/cli/fixtures/sample-errors.json"
```

**Result**: JSON array with 8 entries (7 error/warning level) covering 3 services:
`api-gateway`, `payment-service`, `worker`.

## Step 2 — Read service map

```bash
cat ".github/service-map.yml"
```

**Result**: File not found. Service-to-repo ownership mapping is unavailable.
TARGET_REPO defaults to current repo (`swenyai/sweny`).

## Step 3 — Check known issues

Known issue LOCAL-1: _CLI Typecheck and Format Failures After DAG Spec v2 Migration_ (open).
None of the production errors in the sample log match LOCAL-1 — these are distinct runtime errors
from different services.

## Step 4 — Error triage by frequency and severity

| Rank | Service | Error | Count | Status |
|------|---------|-------|-------|--------|
| 1 | `api-gateway` | `TypeError: Cannot read properties of undefined (reading 'userId')` at `auth.ts:42` | 3 | 500 |
| 2 | `worker` | `ECONNREFUSED 127.0.0.1:5432` — PostgreSQL connection refused | 2 | — |
| 3 | `payment-service` | Stripe webhook signature verification failed | 1 | 400 |

One additional warning (payment retry 3/5) not classified as an error.

## Step 5 — Root cause analysis: api-gateway auth TypeError

Stack trace (present in 2 of 3 occurrences):
```
TypeError: Cannot read properties of undefined (reading 'userId')
    at AuthMiddleware.verify (/src/middleware/auth.ts:42:28)
    at processRequest (/src/server.ts:118:5)
```

Affected endpoints:
- `GET /api/v1/users/profile` (req_abc123)
- `GET /api/v1/users/settings` (req_def456)
- `POST /api/v1/orders` (req_ghi789)

All three are authenticated routes. The middleware accesses `.userId` on a value that is
`undefined` — the decoded JWT/session object. The guard is missing before the property
access on line 42 of `auth.ts`.

Canonical fix pattern:
```typescript
// Before (line 42 — crashes when decodedToken/session is undefined):
const userId = decodedToken.userId;

// After:
if (!decodedToken) throw new UnauthorizedError('Missing or invalid token');
const userId = decodedToken.userId;
```

## Step 6 — Root cause analysis: worker PostgreSQL ECONNREFUSED

Two jobs (`job_abc` / `send_notification`, `job_def` / `process_payment`) failed immediately
(retry_count: 0) with `ECONNREFUSED 127.0.0.1:5432`. This points to a PostgreSQL instance
that is either down or not reachable at localhost. Likely infrastructure issue rather than
a code bug — though the worker should be retrying rather than failing immediately.

## Step 7 — Root cause analysis: payment-service Stripe webhook failure

Single occurrence — Stripe signature mismatch on `/webhooks/stripe`. Most commonly caused
by a rotated webhook secret that was not updated in the service's environment config.
Low frequency (1 hit), lower priority.

## Conclusion

Best candidate for fixing: `api-gateway` auth middleware null guard at `auth.ts:42`.
Highest frequency (3 of 8 log entries = 37%), direct user-facing 500 errors on core endpoints,
clear and minimal code fix with high confidence.
