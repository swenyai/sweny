# Task: Add Coding Agent Provider Selection to GitHub Action

## Why

The GitHub Action (`action.yml` + `packages/action/src/`) currently hardcodes Claude
(`claudeCode`) as the coding agent regardless of configuration:

```typescript
// packages/action/src/providers/index.ts — line 185
registry.set("codingAgent", claudeCode({ logger: actionsLogger }));
```

The CLI (`packages/cli/src/providers/index.ts`) already supports three providers:
- `claude` → `claudeCode` from `@sweny-ai/providers/coding-agent`
- `codex` → `openaiCodex` from `@sweny-ai/providers/coding-agent`
- `gemini` → `googleGemini` from `@sweny-ai/providers/coding-agent`

Users who want to use OpenAI Codex or Google Gemini for the implementation step cannot
do so via the action. This task brings the action to parity with the CLI.

---

## Files to change

1. `action.yml` (repo root)
2. `packages/action/src/config.ts`
3. `packages/action/src/providers/index.ts`
4. `packages/action/src/main.ts`

---

## Step 1 — `action.yml`

Add three new inputs. Place them directly after the `claude-oauth-token` input block
(around line 15), since these are auth credentials for agent providers:

```yaml
  # Coding agent provider
  coding-agent-provider:
    description: "Coding agent to use for implementation (claude, codex, gemini)"
    required: false
    default: "claude"

  # OpenAI credentials (when coding-agent-provider = codex)
  openai-api-key:
    description: "OpenAI API key (required when coding-agent-provider is codex)"
    required: false

  # Google credentials (when coding-agent-provider = gemini)
  gemini-api-key:
    description: "Google Gemini API key (required when coding-agent-provider is gemini)"
    required: false
```

---

## Step 2 — `packages/action/src/config.ts`

### 2a. Add fields to `ActionConfig` interface

After the `claudeOauthToken` field (around line 6):

```typescript
  // Coding agent
  codingAgentProvider: string;
  openaiApiKey: string;
  geminiApiKey: string;
```

### 2b. Read inputs in `parseInputs()`

After `claudeOauthToken` (around line 72):

```typescript
    codingAgentProvider: core.getInput("coding-agent-provider") || "claude",
    openaiApiKey: core.getInput("openai-api-key"),
    geminiApiKey: core.getInput("gemini-api-key"),
```

### 2c. Add validation in `validateInputs()`

The existing auth check (lines 129–132) only validates that at least one of
`anthropic-api-key` or `claude-oauth-token` is provided. Extend it to also validate
agent-specific credentials:

```typescript
  // Auth: validate credentials match the selected coding agent
  switch (config.codingAgentProvider) {
    case "claude":
      if (!config.anthropicApiKey && !config.claudeOauthToken) {
        errors.push("Missing required input: either `anthropic-api-key` or `claude-oauth-token` must be provided when `coding-agent-provider` is `claude`");
      }
      break;
    case "codex":
      if (!config.openaiApiKey) {
        errors.push("Missing required input: `openai-api-key` is required when `coding-agent-provider` is `codex`");
      }
      break;
    case "gemini":
      if (!config.geminiApiKey) {
        errors.push("Missing required input: `gemini-api-key` is required when `coding-agent-provider` is `gemini`");
      }
      break;
  }
```

Remove (or update) the old blanket auth check that requires claude credentials
regardless of provider.

---

## Step 3 — `packages/action/src/providers/index.ts`

### 3a. Update the import on line 17

```typescript
// Before
import { claudeCode } from "@sweny-ai/providers/coding-agent";

// After
import { claudeCode, openaiCodex, googleGemini } from "@sweny-ai/providers/coding-agent";
```

### 3b. Replace the hardcoded coding agent (line 184–185)

```typescript
// Before
registry.set("codingAgent", claudeCode({ logger: actionsLogger }));

// After
switch (config.codingAgentProvider) {
  case "codex":
    registry.set("codingAgent", openaiCodex({ logger: actionsLogger }));
    break;
  case "gemini":
    registry.set("codingAgent", googleGemini({ logger: actionsLogger }));
    break;
  case "claude":
  default:
    registry.set("codingAgent", claudeCode({ logger: actionsLogger }));
    break;
}
```

---

## Step 4 — `packages/action/src/main.ts`

The `mapToTriageConfig` function builds `agentEnv` — the env vars passed to the coding
agent subprocess. Currently it only adds `ANTHROPIC_API_KEY` and
`CLAUDE_CODE_OAUTH_TOKEN` (lines 44–45).

Add Codex and Gemini keys so the agent process can authenticate:

```typescript
  if (config.anthropicApiKey) agentEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.claudeOauthToken) agentEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOauthToken;
  if (config.openaiApiKey) agentEnv.OPENAI_API_KEY = config.openaiApiKey;    // add
  if (config.geminiApiKey) agentEnv.GEMINI_API_KEY = config.geminiApiKey;    // add
```

---

## Tests to update

**File:** `packages/action/tests/providers.test.ts`

The test file covers provider wiring. Add test cases:

1. `codingAgentProvider: "claude"` → verify `claudeCode` is wired
2. `codingAgentProvider: "codex"` → verify `openaiCodex` is wired
3. `codingAgentProvider: "gemini"` → verify `googleGemini` is wired

Follow the pattern of the existing provider wiring tests in that file.

---

## How to run tests

```bash
cd packages/action
npm test
```

---

## Usage example after this change

```yaml
- uses: swenyai/sweny@main
  with:
    coding-agent-provider: codex
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    observability-provider: datadog
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
```

---

## Reference

See `packages/cli/src/providers/index.ts` for how the CLI wires all three coding agents.
The action should mirror that logic exactly. The factory functions accept `{ logger }`
as their only option — credentials come from `agentEnv` env vars passed to the subprocess.
