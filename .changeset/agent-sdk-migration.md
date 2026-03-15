---
"@sweny-ai/agent": minor
"@sweny-ai/providers": minor
---

Migrate `@sweny-ai/agent` to `@anthropic-ai/claude-agent-sdk` (Anthropic split the programmatic SDK from the CLI binary).

**Breaking in `@sweny-ai/agent`**: `customSystemPrompt` option renamed to `systemPrompt`.

**New in `@sweny-ai/providers`**: File observability provider — use a local JSON log file as the observability source. Useful for CI exports and offline triage.
