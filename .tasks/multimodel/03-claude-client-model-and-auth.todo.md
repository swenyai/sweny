# Task 03 — ClaudeClient: model wiring + explicit auth precedence (SWENY_AUTH)

**Feature:** Multi-model cost tiering (issue #207). Depends on Tasks 01-02.
**This task:** (a) Apply the per-node model inside `ClaudeClient.run`. (b) Replace the unconditional API-key strip with an explicit, billing-safe auth mode.

## Why
- `ClaudeClient.run` must honor the `model` opts the executor now passes, falling back to the client default, then to Claude Code's default when both are absent.
- Today `buildEnv` deletes `ANTHROPIC_API_KEY` whenever `CLAUDE_CODE_OAUTH_TOKEN` is set. That protects a subscription from a stray `.env` key, but it breaks gateway users (LiteLLM) who authenticate with a key/bearer while an OAuth token is also present. The fix is an explicit `SWENY_AUTH` mode, NOT inference from `ANTHROPIC_BASE_URL` (a base URL does not imply a non-billing gateway: pass-through proxies bill the real key, so inferring would re-introduce surprise billing).

## Background you need
- `ClaudeClient.ask` already takes a per-call `model?` and computes `effectiveModel = model ?? this.model`. Mirror that in `run`.
- The Claude Agent SDK maps `ANTHROPIC_API_KEY` → `x-api-key` (billing-sensitive console key) and `ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer` (gateway bearer, not a console key). Many LiteLLM setups need the bearer.
- `buildEnv` snapshots `process.env` dropping nullish values; empty string survives. The action sets `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` to `""` when unset, so all credential checks MUST be truthy checks, not key-presence.
- sweny only controls which credentials *survive* into the subprocess env; the spawned agent (and on-disk `~/.claude/.credentials.json`) picks the actual winner. Document/test accordingly.

## Files
- `packages/core/src/claude.ts` —
  - In `run`: destructure `model`, compute `effectiveModel = model ?? this.model`, emit the SDK `model` option only when `effectiveModel` is set.
  - Add exported pure `resolveAuthEnv(env, opts)` + types `SwenyAuthMode` (`auto|api-key|oauth`) and `ResolveAuthEnvOpts` (`{ mode?, logger? }`). `buildEnv` becomes a snapshot + `resolveAuthEnv` call.
  - Modes: `auto` = today's behavior (strip key iff OAuth truthy, never touch bearer); `api-key` = keep key + bearer even with OAuth present; `oauth` = strip key AND bearer. Invalid `SWENY_AUTH` → warn + fall back to `auto`, never throw. Debug-log the mode only, never values.
- `packages/core/src/index.ts` — export `resolveAuthEnv`, `resolveExecutionModel`, and the auth types.

## Tests
- `packages/core/src/__tests__/auth-env.test.ts` (new) — every row of the precedence table: auto strip/no-op/bare-key/bearer-kept/empty-string-unset; api-key keeps both; oauth strips both; invalid value warns + falls back; `opts.mode` override; purity (returns a copy); debug log contains the mode but no secret substrings.

## Acceptance
- `auto` is byte-for-byte the historical behavior (verify against the old two-line strip).
- No remaining quadrant surprise-bills a real Anthropic API account.
- `npm run typecheck` + `npx vitest run` green.

## Verification
```
npm run typecheck --workspace=packages/core
cd packages/core && npx vitest run auth-env claude
```
