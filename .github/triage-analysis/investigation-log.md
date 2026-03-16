# Investigation Log — 2026-03-16

## Approach

Additional instructions: autonomous improvement agent, broad mandate.
CI failures from `/tmp/ci-failures.json` show recurring `CI on main` and `Deploy Docs` failures.
GitHub Actions API returned 404 for expired run details, so pivoted to holistic codebase exploration.

## Step 1 — Read CI Failures

The CI failures log contained ~20 entries:
- `CI on main` (run_id: 23132498377, 23131264950)
- `Deploy Docs on main` (run_id: 23132498397, 23131264956)
- Multiple dependabot branch failures

GitHub Actions API returned 404 — run details not accessible (likely expired).

## Step 2 — Codebase Exploration

Ran broad exploration of:
- `packages/providers/src/` — all 30+ provider implementations
- `packages/engine/src/` — runner, validate, schema
- `packages/cli/src/` — CLI main entry
- `packages/action/src/` — GitHub Action entrypoint

## Step 3 — Identify Provider Config Schema Mismatch Bug

Read `packages/engine/src/runner-recipe.ts` lines 44-66 — `validateWorkflowConfig()` checks
env vars listed in `provider.configSchema.fields`. Found that several providers list FEWER
fields than their Zod schemas require, causing silent pre-flight validation passes that lead
to runtime crashes.

**Verified providers:**

| Provider | Zod required | configSchema.fields | Gap |
|----------|-------------|---------------------|-----|
| NewRelic | apiKey, accountId | NR_API_KEY only | NR_ACCOUNT_ID missing |
| Sentry | authToken, organization, project | SENTRY_AUTH_TOKEN only | SENTRY_ORG, SENTRY_PROJECT missing |
| Datadog | apiKey, appKey | DD_API_KEY, DD_APPLICATION_KEY | ✅ complete |
| Splunk | baseUrl, token | SPLUNK_URL, SPLUNK_TOKEN | ✅ complete |
| Elastic | baseUrl, apiKey | ELASTIC_URL, ELASTIC_API_KEY | ✅ complete |
| Loki | baseUrl (apiKey/orgId optional) | LOKI_URL | ✅ complete |
| Linear | apiKey | LINEAR_API_KEY | ✅ complete |
| Jira | baseUrl, email, apiToken | all 3 listed | ✅ complete |

Confirmed correct env var names from:
- `newrelic.ts getAgentEnv()` → exports `NR_ACCOUNT_ID`
- `sentry.ts getAgentEnv()` → exports `SENTRY_ORG`, `SENTRY_PROJECT`
- `action/src/config.ts validateInputs()` → checks `newrelic-account-id`, `sentry-org`, `sentry-project`

## Conclusion

Best candidate: Fix `newrelicProviderConfigSchema` and `sentryProviderConfigSchema` to include
all required env var fields. Small, targeted, high-impact fix affecting all users of these providers.
