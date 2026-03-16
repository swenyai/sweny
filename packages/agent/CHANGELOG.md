# @sweny-ai/agent

## 0.2.0

### Minor Changes

- c0119dc: Migrate `@sweny-ai/agent` to `@anthropic-ai/claude-agent-sdk` (Anthropic split the programmatic SDK from the CLI binary).

  **Breaking in `@sweny-ai/agent`**: `customSystemPrompt` option renamed to `systemPrompt`.

  **New in `@sweny-ai/providers`**: File observability provider — use a local JSON log file as the observability source. Useful for CI exports and offline triage.

### Patch Changes

- Updated dependencies [c0119dc]
- Updated dependencies [1204f4f]
  - @sweny-ai/providers@1.1.0
