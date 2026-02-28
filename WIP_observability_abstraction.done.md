# WIP — Abstract Observability Providers

## Goal
Eliminate Datadog-specific leakage from config, provider factory, investigation prompt,
and analysis directory names. Each provider becomes self-describing (env vars + prompt
instructions), matching the quality of the channel and agent/runner abstractions.

## Tasks

| # | Task | Status |
|---|------|--------|
| 1 | Add `getAgentEnv()` and `getPromptInstructions()` to ObservabilityProvider interface | done |
| 2 | Implement new methods in datadog.ts | done |
| 3 | Implement new methods in sentry.ts | done |
| 4 | Implement new methods in cloudwatch.ts | done |
| 5 | Refactor ActionConfig: replace dd* fields with generic observability credentials | done |
| 6 | Wire all 3 providers in createProviders() switch | done |
| 7 | Refactor investigate.ts: use provider methods, rename `.github/datadog-analysis` → `.github/triage-analysis` | done |
| 8 | Refactor implement.ts + notify.ts + github.ts: rename `.github/datadog-analysis` → `.github/triage-analysis` | done |
| 9 | Update action.yml with sentry + cloudwatch inputs | done |
| 10 | Typecheck + test (594 tests pass, all 3 workspaces clean) | done |

## Verification
- `npm run typecheck` — all 3 workspaces pass (action, agent, providers)
- `npm test` — 594 tests pass (86 action + 263 agent + 245 providers)

## Changes Summary
- **ObservabilityProvider interface** (`types.ts`): Added `getAgentEnv()` and `getPromptInstructions()` — each provider declares what env vars and API docs the coding agent needs
- **3 providers** (datadog, sentry, cloudwatch): Each implements self-describing methods with provider-specific env vars, API docs, and curl examples
- **ActionConfig** (`config.ts`): Replaced `ddApiKey/ddAppKey/ddSite` with generic `observabilityCredentials: Record<string, string>`, parsed per-provider via `parseObservabilityCredentials()`
- **createProviders()** (`providers/index.ts`): Wired all 3 providers in switch statement
- **investigate.ts**: Uses `providers.observability.getAgentEnv()` and `providers.observability.getPromptInstructions()` instead of hardcoded Datadog content
- **Global rename**: `.github/datadog-analysis/` → `.github/triage-analysis/` across all files (investigate, implement, notify, github source control, .gitignore, tests)
- **action.yml**: Added sentry and cloudwatch input declarations
- **Tests**: Updated all test helpers to use new config shape, added tests for `getAgentEnv()` and `getPromptInstructions()` on all 3 providers
