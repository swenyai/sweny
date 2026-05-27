# Task 04 — Gateway surface: Action inputs, CLI config, connectivity check

**Feature:** Multi-model cost tiering (issue #207). Depends on Task 03.
**This task:** Expose the gateway path through the GitHub Action and the CLI, and make `sweny check` gateway-aware.

## Why
- The GitHub Action is the main product entry point and currently has no base-URL or auth-mode input, so a gateway is unreachable through it.
- `sweny check` hardcodes `https://api.anthropic.com/v1/models` with `x-api-key` and ignores any base URL, so a gateway user has their key probed against real Anthropic (wrong endpoint, possibly the wrong header).

## Background you need
- Action auth is wired in `action.yml` (`inputs` block + the "Validate auth inputs" step + the "Run workflow" step env). Today the validate step hard-fails unless OAuth or api-key is present; a bearer-only gateway user would be wrongly rejected.
- CLI config is built by `parseCliInputs` in `packages/core/src/cli/config.ts` (NOT `loadConfig`). Secrets are env-only; non-secret config (like `gitlabBaseUrl`) is env-or-file via the `f(...)` helper.
- Connectivity check lives in `packages/core/src/cli/check.ts` (`checkProviderConnectivity` + `checkAnthropic`). The SessionStart hook just shells out to `sweny check`.

## Files
- `action.yml` — add inputs `anthropic-base-url`, `anthropic-auth-token`, `sweny-auth` (default `auto`); wire them into the run-step env (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `SWENY_AUTH`); relax the validate step to also accept `anthropic-auth-token`.
- `packages/core/src/cli/config.ts` — add `anthropicAuthToken` (env-only secret), `anthropicBaseUrl` (env-or-file), `swenyAuth` (env-or-file via a `normalizeSwenyAuth` helper that falls back to `auto`). Update `CliConfig`.
- `packages/core/src/cli/config.test.ts` and `packages/core/src/cli/__tests__/report-cloud.test.ts` — add the new fields to their `CliConfig` literal fixtures.
- `packages/core/src/cli/check.ts` — `resolveCheckAuthMode(config)` picks oauth/api-key/auth-token/none from `swenyAuth` + present creds; when `anthropicBaseUrl` is set, probe the gateway (header by mode) instead of real Anthropic; redact the URL to scheme+host before any output; report the selected auth mode.

## Tests
Connectivity + config tests are added in Task 06 (validation pass): `normalizeSwenyAuth`, `resolveCheckAuthMode`, `redactUrl`, gateway probe behavior. Keep the existing fixtures compiling here.

## Acceptance
- A bearer-only gateway user passes the action validate step.
- `sweny check` in gateway mode never probes real Anthropic with a gateway key, reports the auth mode, and logs no secrets (URL redacted).
- `npm run typecheck` + `npx vitest run` green.

## Verification
```
npm run typecheck --workspace=packages/core
cd packages/core && npx vitest run config check report-cloud
```
