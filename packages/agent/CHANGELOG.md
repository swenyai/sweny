# @sweny-ai/agent

## 0.2.1

### Patch Changes

- a7ab63e: Add missing npm package metadata: keywords, bugs URL, and description improvements across all published packages. Fix engine description to say "Workflow" (not "Recipe"). Align Node.js engine requirement for cli and agent to >=22.0.0 to match providers (which uses global fetch).
- Updated dependencies [a7ab63e]
  - @sweny-ai/providers@1.1.1

## 0.2.0

### Minor Changes

- c0119dc: Migrate `@sweny-ai/agent` to `@anthropic-ai/claude-agent-sdk` (Anthropic split the programmatic SDK from the CLI binary).

  **Breaking in `@sweny-ai/agent`**: `customSystemPrompt` option renamed to `systemPrompt`.

  **New in `@sweny-ai/providers`**: File observability provider — use a local JSON log file as the observability source. Useful for CI exports and offline triage.

### Patch Changes

- Updated dependencies [c0119dc]
- Updated dependencies [1204f4f]
  - @sweny-ai/providers@1.1.0
