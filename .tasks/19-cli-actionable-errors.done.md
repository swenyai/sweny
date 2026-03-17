# Task 19 — CLI: actionable error messages for missing credentials

## Goal

When a user's triage or implement run fails because a credential is missing or
wrong, the error today is a raw provider error message (often cryptic). The CLI
should detect common failure patterns and print a clear, actionable hint that
tells the user exactly what to set and where.

This is a **retention** fix: the #1 reason new users churn is "it didn't work
and I didn't know how to fix it".

## Context

- **`packages/cli/src/main.ts`** — the `triageCmd.action` and `implementCmd.action`
  handlers have a `catch` block (lines ~269-279, ~330-333) that currently calls
  `formatCrashError(error)`.
- **`packages/cli/src/output.ts`** — `formatCrashError` just prints the error
  message. It has no special-casing.
- **`packages/cli/src/config.ts`** — `validateInputs()` checks required fields
  at startup; adds a pre-run guard before providers are even created.

## What to implement

### 1. Credential hints at startup (pre-run, zero cost)

In `validateInputs()` or before calling `createProviders()`, detect missing
required credentials and print a targeted hint. Examples:

```
  Error: Anthropic API key not found.
  Set ANTHROPIC_API_KEY in your environment or .env file, or use --anthropic-api-key.
  Get a key at: https://console.anthropic.com/

  Error: Datadog credentials not found.
  Set DD_API_KEY and DD_APP_KEY, or configure them in .sweny.yml.
```

Map provider + missing credential → human message. Required pairs:
| Provider config | Required env var | Link |
|---|---|---|
| `codingAgentProvider=claude` (no key) | `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` | console.anthropic.com |
| `observabilityProvider=datadog` | `DD_API_KEY` + `DD_APP_KEY` | |
| `observabilityProvider=sentry` | `SENTRY_AUTH_TOKEN` | |
| `issueTrackerProvider=linear` | `LINEAR_API_KEY` | |
| `sourceControlProvider=github` (implement) | `GITHUB_TOKEN` | |

The checks should run BEFORE starting the spinner/progress output.

### 2. Hint extraction for runtime errors

In `formatCrashError` (in `output.ts`), add pattern matching:

```typescript
function extractCredentialHint(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|unauthorized|authentication/i.test(msg) && /anthropic/i.test(msg)) {
    return "Check your ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.";
  }
  if (/401|403|unauthorized/i.test(msg) && /datadog/i.test(msg)) {
    return "Check your DD_API_KEY and DD_APP_KEY.";
  }
  if (/ENOTFOUND|ETIMEDOUT|network/i.test(msg)) {
    return "Network error — check your internet connection and provider endpoint.";
  }
  return null;
}
```

Then in `formatCrashError`:
```typescript
const hint = extractCredentialHint(err);
if (hint) output += `\n  Hint: ${hint}`;
```

## Changeset

Create `.changeset/cli-actionable-errors.md`:
```md
---
"@sweny-ai/cli": patch
---
The CLI now prints actionable hints for common credential errors before running
(missing API keys) and when a run fails with an authentication error.
```

## Tests

Add to `packages/cli/tests/output.test.ts` (create if not exists):
- `extractCredentialHint` returns hint for 401 Anthropic error
- `extractCredentialHint` returns hint for Datadog 401
- `extractCredentialHint` returns null for unrecognized error
- `extractCredentialHint` returns network hint for ENOTFOUND

## Done when

- [ ] Pre-run credential checks in `validateInputs` or before provider creation
- [ ] `extractCredentialHint` in output.ts with ≥3 patterns
- [ ] `formatCrashError` appends hint when found
- [ ] Tests added
- [ ] Changeset created
- [ ] `npm test` passes in `packages/cli`
- [ ] `npx tsc --noEmit` passes
