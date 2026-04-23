# Fix #16: Unify source resolution across CLI and executor

_Part of HARDENING_PLAN.v1.claude.md (P4)._

## Goal

One source-resolution code path. Rules and context fetched by the CLI must honor `offline` and `fetchAuth` the same way the executor's per-node Sources do. Today they don't.

## Why this matters

The executor has a structured Source resolver (`source-resolver.ts`) that honors:
- `offline: true` — URL Sources throw rather than fetch.
- `fetchAuth: { "host": "ENV_VAR" }` — Bearer auth for per-host URLs.
- Source-origin tracing for debugging.

The CLI's `resolveRulesAndContext()` uses `loadAdditionalContext()` from `templates.ts`, which hardcodes `{ offline: false, authConfig: {} }`. Rules/context resolved via this path silently ignore both flags.

A user runs `sweny workflow run foo.yml --offline` with `--rules https://internal.corp/rules.md`. They expect the URL to be skipped. Instead the CLI fetches it anyway. The executor would refuse — the CLI doesn't.

## Current state (what you'll find)

- `packages/core/src/cli/main.ts:~190` — `resolveRulesAndContext()` calls `loadAdditionalContext(config.rules)` and `loadAdditionalContext(config.context)`.
- `packages/core/src/templates.ts:~114` — `loadAdditionalContext()` builds a `defaultCtx` with `offline: false`, `authConfig: {}` (hardcoded). Then calls `resolveSource` per source.
- `packages/core/src/source-resolver.ts` — the authoritative resolver, honors both flags via its `SourceResolutionContext` param.
- `packages/core/src/cli/main.ts:~410` — `executor.ts` calls later pass `fetchAuth`, `offline` correctly into `execute()`. The inconsistency is only on the pre-execute rules/context step.

## What to do

### Step 1 — thread offline/fetchAuth through `loadAdditionalContext`

Update signature in `packages/core/src/templates.ts`:

```ts
export async function loadAdditionalContext(
  sources: string[],
  options: {
    cwd?: string;
    offline?: boolean;
    fetchAuth?: Record<string, string>;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{ resolved: string; urls: string[] }>
```

- Pass the options directly into the `SourceResolutionContext` instead of using the hardcoded `defaultCtx`.
- Default values preserve current behavior for callers that don't pass them.

Same update for `loadTemplate()` if it shares the same pattern.

### Step 2 — update CLI callsites

In `packages/core/src/cli/main.ts`:

- `resolveRulesAndContext(config)` → pass `{ cwd: process.cwd(), offline: config.offline, fetchAuth: config.fetchAuth, env: process.env }` into each `loadAdditionalContext` call.
- Every other invocation (`triage`, `implement`, `workflow run`) — check and update.

### Step 3 — tests

- `packages/core/src/__tests__/templates.test.ts` (or similar, create if missing):
  - Test that `loadAdditionalContext(['https://example.com/x.md'], { offline: true })` throws rather than fetches.
  - Test that `loadAdditionalContext(['https://api.internal/x.md'], { fetchAuth: { 'api.internal': 'MY_TOKEN' }, env: { MY_TOKEN: 'secret' } })` sends Bearer `secret` in the request.
- Existing `cli/config.test.ts` already covers the CLI flag parsing; no change needed there.

### Step 4 — (optional) tracing

Consider adding an `ExecutionEvent` type `sources:resolved` is already defined in `types.ts:236` but unused for CLI-level rules/context. Out of scope for this fix — leave a `// TODO(trace)` comment near the new wiring.

## Acceptance criteria

- [ ] `loadAdditionalContext` honors `offline` and `fetchAuth` options.
- [ ] CLI call sites in `main.ts` pass the right options.
- [ ] `--offline` causes URL rules/context to throw (not silently fetch).
- [ ] Host-scoped `fetch.auth` from `.sweny.yml` causes Authorization headers on matching URLs.
- [ ] `npm run typecheck --workspace=packages/core` passes.
- [ ] `npx vitest run --dir packages/core/src` passes including new tests.
- [ ] No regression in existing template-loading tests.

## Out of scope

- Source-event emission for traceability (a separate concern).
- Removing `templates.ts` entirely — keep backwards-compatible wrappers.

## Verify when done

```bash
cd packages/core
grep -n "defaultCtx(cwd)" src/templates.ts   # should be gone or parameterized
npm test
```
