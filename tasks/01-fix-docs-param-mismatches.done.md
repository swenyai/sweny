# Fix Documentation Parameter Mismatches

## Problem
The docs site at `packages/web/src/content/docs/providers/` has code examples with wrong parameter names. Users who copy-paste will get runtime errors.

## Fixes Required

### 1. Messaging (slack) — `botToken` → `token`
- **File**: `packages/web/src/content/docs/providers/messaging.md`
- **Source of truth**: `packages/providers/src/messaging/slack.ts` — the Zod schema field is `token`, not `botToken`
- Change the example config from `botToken` to `token`

### 2. Auth (apiKeyAuth) — wrong validate signature
- **File**: `packages/web/src/content/docs/providers/auth.md`
- **Source of truth**: `packages/providers/src/auth/api-key.ts` — the `validate` function signature is `(apiKey: string) => Promise<UserIdentity | null>` (single param, no userId)
- Fix the example to match the actual signature

### 3. Incident (pagerduty) — `apiKey` → `apiToken`
- **File**: `packages/web/src/content/docs/providers/incident.md`
- **Source of truth**: `packages/providers/src/incident/pagerduty.ts` — the Zod schema field is `apiToken`, not `apiKey`
- Change the example config from `apiKey` to `apiToken`

### 4. Observability (cloudwatch) — `logGroupName` → `logGroupPrefix`
- **File**: `packages/web/src/content/docs/providers/observability.md`
- **Source of truth**: `packages/providers/src/observability/cloudwatch.ts` — the field is `logGroupPrefix`
- Change the example config from `logGroupName` to `logGroupPrefix`

### 5. Storage (s3) — region example says `us-east-1`, default is `us-west-2`
- **File**: `packages/web/src/content/docs/providers/storage.md`
- **Source of truth**: `packages/providers/src/storage/s3.ts` — default region is `us-west-2`
- Update the example or add a note about the default

## Verification
- Read each source file to confirm the correct parameter name
- Read each doc file, make the fix
- Run `npm run build --workspace=packages/web` from repo root to verify site builds
