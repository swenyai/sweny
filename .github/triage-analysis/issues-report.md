# Issues Report — 2026-03-16

## Issue 1: NewRelic and Sentry Provider Config Schemas Missing Required Env Var Fields

- **Severity**: High
- **Environment**: All (production and local — any env using these providers)
- **Frequency**: Affects all users of NewRelic or Sentry providers

### Description

The engine's pre-flight validation (`validateWorkflowConfig` in `runner-recipe.ts`) checks
`provider.configSchema.fields` to verify required environment variables are set before the
workflow starts. Two providers have incomplete `fields` arrays — they list fewer env vars than
their Zod schemas require — causing the pre-flight check to silently pass when critical env vars
are missing, producing confusing runtime failures mid-workflow instead of a clear upfront error.

**NewRelic** (`packages/providers/src/observability/newrelic.ts`):
- Zod schema requires: `apiKey`, `accountId`
- `newrelicProviderConfigSchema.fields` lists: only `NR_API_KEY`
- Missing: `NR_ACCOUNT_ID`

**Sentry** (`packages/providers/src/observability/sentry.ts`):
- Zod schema requires: `authToken`, `organization`, `project`
- `sentryProviderConfigSchema.fields` lists: only `SENTRY_AUTH_TOKEN`
- Missing: `SENTRY_ORG`, `SENTRY_PROJECT`

### Evidence

`newrelic.ts` line 17-21 — configSchema only lists one field:
```typescript
export const newrelicProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "New Relic",
  fields: [{ key: "apiKey", envVar: "NR_API_KEY", description: "New Relic User API key" }],
  //       ^^^^^ missing accountId / NR_ACCOUNT_ID
};
```

But `newrelic.ts` line 163-168 — `getAgentEnv()` shows the expected env vars:
```typescript
getAgentEnv(): Record<string, string> {
  return {
    NR_API_KEY: this.apiKey,
    NR_ACCOUNT_ID: this.accountId,   // ← this IS required
    NR_REGION: this.region,
  };
}
```

`sentry.ts` line 18-22 — configSchema only lists one field, but Zod requires three:
```typescript
export const sentryProviderConfigSchema: ProviderConfigSchema = {
  role: "observability",
  name: "Sentry",
  fields: [{ key: "authToken", envVar: "SENTRY_AUTH_TOKEN", description: "Sentry authentication token" }],
  //       ^^^^^ missing organization/SENTRY_ORG, project/SENTRY_PROJECT
};
```

`runner-recipe.ts` line 56-58 — the validation that is missed:
```typescript
const missing = provider.configSchema.fields
  .filter((f) => f.required !== false && !process.env[f.envVar])
  .map((f) => f.envVar);
```

### Root Cause Analysis

When new required fields were added to the Zod schemas (accountId for NewRelic,
organization/project for Sentry), the corresponding `ProviderConfigSchema.fields` arrays
were not updated. The two validation paths (Zod and configSchema) became out of sync.

### Impact

- Users running NewRelic or Sentry without `NR_ACCOUNT_ID` / `SENTRY_ORG` / `SENTRY_PROJECT`
  pass pre-flight but get cryptic runtime failures when the provider actually executes API calls
- Debug experience is poor: no clear error message pointing to the missing variable
- All workflows using these providers are affected

### Suggested Fix

Add the missing fields to each provider's `ProviderConfigSchema.fields`:

**newrelic.ts**:
```typescript
fields: [
  { key: "apiKey", envVar: "NR_API_KEY", description: "New Relic User API key" },
  { key: "accountId", envVar: "NR_ACCOUNT_ID", description: "New Relic account ID" },
],
```

**sentry.ts**:
```typescript
fields: [
  { key: "authToken", envVar: "SENTRY_AUTH_TOKEN", description: "Sentry authentication token" },
  { key: "organization", envVar: "SENTRY_ORG", description: "Sentry organization slug" },
  { key: "project", envVar: "SENTRY_PROJECT", description: "Sentry project slug" },
],
```

### Files to Modify

- `packages/providers/src/observability/newrelic.ts` — line 20, add accountId field
- `packages/providers/src/observability/sentry.ts` — line 21, add organization and project fields

### Confidence Level

Very High — direct code inspection confirms the mismatch; env var names confirmed via
`getAgentEnv()` and `action/src/config.ts` validation logic.

### GitHub Issues Status

No existing GitHub Issues issue found — New issue will be created.
