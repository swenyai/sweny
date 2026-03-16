---
"@sweny-ai/providers": patch
---

Fix NewRelic and Sentry provider config schemas missing required env var fields.

`newrelicProviderConfigSchema` was missing `NR_ACCOUNT_ID` and `sentryProviderConfigSchema`
was missing `SENTRY_ORG` and `SENTRY_PROJECT`. The engine's pre-flight validation checks
only the fields listed in `configSchema.fields`, so these required env vars were silently
skipped — causing cryptic mid-workflow runtime failures instead of a clear upfront error.
