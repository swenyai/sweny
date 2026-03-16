<!-- TRIAGE_FINGERPRINT
error_pattern: provider configSchema.fields missing required env vars NR_ACCOUNT_ID SENTRY_ORG SENTRY_PROJECT
service: sweny-providers
first_seen: 2026-03-16
run_id: direct-run-2026-03-16
-->

RECOMMENDATION: implement

TARGET_SERVICE: sweny-providers
TARGET_REPO: swenyai/sweny

**GitHub Issues Issue**: None found - New issue will be created

# NewRelic and Sentry Provider Config Schemas Missing Required Env Var Fields

## Summary

The `ProviderConfigSchema.fields` arrays for the NewRelic and Sentry observability providers
are incomplete: they each list only their auth token field, but their Zod schemas require
additional fields (`accountId` for NewRelic; `organization` and `project` for Sentry).

The engine's pre-flight validation in `runner-recipe.ts` uses `configSchema.fields` to check
all required env vars before starting a workflow. Because these fields are missing, the engine
gives users a false "all clear" — then the provider crashes mid-workflow when the missing env
var is actually needed.

## Root Cause

`packages/providers/src/observability/newrelic.ts` line 17-21:
```typescript
// Zod schema (lines 8-13) requires apiKey AND accountId
// But configSchema.fields only lists apiKey:
fields: [{ key: "apiKey", envVar: "NR_API_KEY", description: "New Relic User API key" }],
// NR_ACCOUNT_ID is never checked in pre-flight
```

`packages/providers/src/observability/sentry.ts` line 18-22:
```typescript
// Zod schema (lines 8-14) requires authToken, organization, AND project
// But configSchema.fields only lists authToken:
fields: [{ key: "authToken", envVar: "SENTRY_AUTH_TOKEN", description: "Sentry authentication token" }],
// SENTRY_ORG and SENTRY_PROJECT are never checked in pre-flight
```

Engine validation at `packages/engine/src/runner-recipe.ts` lines 56-58:
```typescript
const missing = provider.configSchema.fields
  .filter((f) => f.required !== false && !process.env[f.envVar])
  .map((f) => f.envVar);
```
Only the fields listed in `configSchema.fields` are checked. Missing fields are invisible to
pre-flight validation.

## Exact Code Changes

**File**: `packages/providers/src/observability/newrelic.ts`, lines 17-21

```typescript
// Before:
export const newrelicProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "New Relic",
  fields: [{ key: "apiKey", envVar: "NR_API_KEY", description: "New Relic User API key" }],
};

// After:
export const newrelicProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "New Relic",
  fields: [
    { key: "apiKey", envVar: "NR_API_KEY", description: "New Relic User API key" },
    { key: "accountId", envVar: "NR_ACCOUNT_ID", description: "New Relic account ID" },
  ],
};
```

**File**: `packages/providers/src/observability/sentry.ts`, lines 18-22

```typescript
// Before:
export const sentryProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Sentry",
  fields: [{ key: "authToken", envVar: "SENTRY_AUTH_TOKEN", description: "Sentry authentication token" }],
};

// After:
export const sentryProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Sentry",
  fields: [
    { key: "authToken", envVar: "SENTRY_AUTH_TOKEN", description: "Sentry authentication token" },
    { key: "organization", envVar: "SENTRY_ORG", description: "Sentry organization slug" },
    { key: "project", envVar: "SENTRY_PROJECT", description: "Sentry project slug" },
  ],
};
```

## Evidence Confirming Correct Env Var Names

`newrelic.ts` `getAgentEnv()` (line 163):
```typescript
return { NR_API_KEY: this.apiKey, NR_ACCOUNT_ID: this.accountId, NR_REGION: this.region };
```

`sentry.ts` `getAgentEnv()` (line 127):
```typescript
return { SENTRY_AUTH_TOKEN: this.authToken, SENTRY_ORG: this.org, SENTRY_PROJECT: this.project, ... };
```

`action/src/config.ts` `validateInputs()` (lines 233-241, 205-213):
```typescript
case "newrelic":
  if (!config.observabilityCredentials.accountId)
    errors.push("Missing required input: `newrelic-account-id` ...");
case "sentry":
  if (!config.observabilityCredentials.organization)
    errors.push("Missing required input: `sentry-org` ...");
  if (!config.observabilityCredentials.project)
    errors.push("Missing required input: `sentry-project` ...");
```

## Files to Modify

- `packages/providers/src/observability/newrelic.ts` — add `accountId`/`NR_ACCOUNT_ID` field
- `packages/providers/src/observability/sentry.ts` — add `organization`/`SENTRY_ORG` and `project`/`SENTRY_PROJECT` fields

## Test Plan

- [ ] Run existing provider tests: `npm test --workspace packages/providers`
- [ ] Verify `validateWorkflowConfig` catches missing `NR_ACCOUNT_ID` when NewRelic is used
- [ ] Verify `validateWorkflowConfig` catches missing `SENTRY_ORG`/`SENTRY_PROJECT` when Sentry is used
- [ ] Confirm no regression in providers that were already correct (Datadog, Splunk, Elastic)

## Rollback Plan

Config schema additions are purely additive metadata — they only cause pre-flight to report
a new error when env vars are absent. Rolling back means removing the two new field entries.
No runtime behavior changes beyond the pre-flight check.

## Confidence

Very High. Code inspection directly confirms the mismatch. The env var names are verified
from three independent sources (getAgentEnv, action config, Zod schemas). Fix is minimal
(two array additions) with zero risk of regression in the happy path.

## Other Providers Audited (All Clear)

- Datadog: both `DD_API_KEY` + `DD_APPLICATION_KEY` in fields ✅
- Splunk: both `SPLUNK_URL` + `SPLUNK_TOKEN` in fields ✅
- Elastic: both `ELASTIC_URL` + `ELASTIC_API_KEY` in fields ✅
- Loki: `LOKI_URL` only required (`apiKey`/`orgId` are optional) ✅
- Linear: single required field `LINEAR_API_KEY` in fields ✅
- Jira: all 3 required fields present ✅
