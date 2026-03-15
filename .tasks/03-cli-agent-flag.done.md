# Task 03: CLI --agent Flag (Multi-Provider Support)

## Context

The GitHub Action already supports `coding-agent-provider: claude|codex|gemini` (landed in Task 02).
The CLI (`sweny implement`, `sweny triage`) has no equivalent flag yet.

**Goal:** `sweny implement --agent codex` or `sweny triage --agent gemini`

Relevant files:
- `packages/cli/src/main.ts` — main CLI, `registerImplementCommand()` / `registerTriageCommand()`
- `packages/cli/src/config.ts` — `CliConfig` interface, `parseCliInputs()`, `validateInputs()`
- `packages/cli/src/providers/index.ts` — `createProviders()` / `createImplementProviders()` — where coding agent is registered

Look at `packages/action/src/config.ts` and `packages/action/src/providers/index.ts` for the exact pattern to mirror.

---

## Changes

### `packages/cli/src/config.ts`

Add to `CliConfig` interface:
```ts
codingAgentProvider: string; // "claude" | "codex" | "gemini", default "claude"
openaiApiKey: string;
geminiApiKey: string;
```

In `parseCliInputs()`, read from options:
```ts
codingAgentProvider: (options.agent as string) ?? fileConfig?.codingAgentProvider ?? "claude",
openaiApiKey: (options.openaiApiKey as string) ?? process.env.OPENAI_API_KEY ?? "",
geminiApiKey: (options.geminiApiKey as string) ?? process.env.GEMINI_API_KEY ?? "",
```

In `validateInputs()`, add validation:
```ts
if (config.codingAgentProvider === "codex" && !config.openaiApiKey) {
  errors.push("openai-api-key is required when coding-agent-provider is codex");
}
if (config.codingAgentProvider === "gemini" && !config.geminiApiKey) {
  errors.push("gemini-api-key is required when coding-agent-provider is gemini");
}
```

### `packages/cli/src/main.ts` — register the flag

In `registerTriageCommand()` and `registerImplementCommand()` (or wherever Commander options are added), add:
```ts
.option("--agent <provider>", "Coding agent to use: claude (default), codex, gemini", "claude")
.option("--openai-api-key <key>", "OpenAI API key (required when --agent codex)")
.option("--gemini-api-key <key>", "Gemini API key (required when --agent gemini)")
```

### `packages/cli/src/providers/index.ts`

In `createProviders()` and `createImplementProviders()`, replace the hardcoded `claudeCode` registration with a switch:

```ts
import { claudeCode, openaiCodex, googleGemini } from "@sweny-ai/providers/coding-agent";

// where coding agent is registered:
const agent =
  config.codingAgentProvider === "codex" ? openaiCodex() :
  config.codingAgentProvider === "gemini" ? googleGemini() :
  claudeCode();

registry.set("codingAgent", agent);
```

Also ensure env vars are set before the agent runs:
```ts
if (config.openaiApiKey) process.env.OPENAI_API_KEY = config.openaiApiKey;
if (config.geminiApiKey) process.env.GEMINI_API_KEY = config.geminiApiKey;
```

### `.sweny.yml` support

In `loadConfigFile()` / the config file schema, add support for:
```yaml
coding-agent-provider: codex
openai-api-key: ${OPENAI_API_KEY}
```

Check `packages/cli/src/config-file.ts` for where YAML fields are mapped to `CliConfig`.

---

## Tests

File: `packages/cli/tests/config.test.ts` (or wherever CLI config is tested)

Add tests:
- default `codingAgentProvider` is `"claude"` when flag not passed
- `--agent codex` without `openai-api-key` → validation error
- `--agent gemini` without `gemini-api-key` → validation error
- `--agent claude` is valid without extra keys

---

## Changeset

`.changeset/cli-agent-flag.md`:
```md
---
"@sweny-ai/cli": minor
---

Add `--agent <provider>` flag to `sweny triage` and `sweny implement`.

Supported values: `claude` (default), `codex`, `gemini`.
Also supported via `.sweny.yml`: `coding-agent-provider: codex`.
```

---

## Done Criteria

- [ ] `sweny implement --agent codex` wires up `openaiCodex()` provider
- [ ] `sweny triage --agent gemini` wires up `googleGemini()` provider
- [ ] `sweny implement` (no flag) still uses `claudeCode()` by default
- [ ] Validation error when `--agent codex` used without `--openai-api-key`
- [ ] `npm test` passes in `packages/cli`
- [ ] Changeset created
