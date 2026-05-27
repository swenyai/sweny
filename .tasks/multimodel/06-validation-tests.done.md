# Task 06 — Validation tests (coverage hardening)

**Feature:** Multi-model cost tiering (issue #207). Final step after implementation.
**This task:** Close the test-coverage gaps so every new code path is validated. Feature-level tests already ship with Tasks 01-03 (schema, model resolution, executor threading, auth env). This task adds the two surfaces that have NO unit tests yet (Task 04: CLI config + connectivity check) and reviews overall coverage.

## Why
`normalizeSwenyAuth` (config) and the new `check.ts` helpers (`resolveCheckAuthMode`, `redactUrl`, `checkAnthropicGateway`) are currently exercised only indirectly. They carry real logic (auth-mode selection, URL redaction = a secret-safety guarantee, gateway probe status mapping) and must be tested directly.

## What to test
- **`normalizeSwenyAuth`** (`packages/core/src/cli/config.ts`): `"api-key"` / `"oauth"` pass through; unknown / empty / undefined / mixed-case fall back to `auto`. Export it if not already exported.
- **`resolveCheckAuthMode`** (`packages/core/src/cli/check.ts`): each `swenyAuth` mode crossed with present/absent creds resolves to the right `oauth|api-key|auth-token|none`. Export it (and `redactUrl`) so they are unit-testable.
- **`redactUrl`**: strips userinfo and query, keeps scheme+host; invalid URL returns a safe placeholder. This guards against leaking a credential embedded in `ANTHROPIC_BASE_URL`.
- **gateway probe** (`checkAnthropicGateway`): with a mocked `fetch`, assert 2xx/404 → `ok`, 401/403 → `fail`, other → `fail`, network error → `fail`; assert the probed URL is the gateway (not `api.anthropic.com`) and the header matches the mode; assert the redacted base appears in `detail` and no secret does.

## Files
- `packages/core/src/cli/config.ts` — export `normalizeSwenyAuth` if needed.
- `packages/core/src/cli/check.ts` — export `resolveCheckAuthMode`, `redactUrl` (keep `checkAnthropicGateway` testable, e.g. via injectable fetch or `vi.stubGlobal('fetch', ...)`).
- `packages/core/src/cli/__tests__/check.test.ts` (new) and config-auth tests (new or appended to `config.test.ts`).

## Acceptance
- Every new function from Tasks 03-04 has direct unit coverage.
- No real network calls in tests (fetch mocked).
- Full sweep green: `npm run typecheck`, `npm run test --workspaces`, `npm run check:schema-drift`, web + spec builds.

## Verification
```
cd packages/core && npx vitest run check config
cd /Users/nate/src/swenyai/sweny
npm run typecheck --workspaces --if-present
npm run test --workspaces --if-present
npm run check:schema-drift --workspace=packages/core
```
