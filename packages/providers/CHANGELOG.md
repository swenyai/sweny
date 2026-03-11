# @sweny-ai/providers

## 0.3.0

### Minor Changes

- 5053263: Add optional `onEvent` streaming callback to coding agent provider configs.
  - `ClaudeCodeConfig`, `GoogleGeminiConfig`, `OpenAICodexConfig`, `MockCodingAgentConfig`
    all accept `onEvent?: AgentEventHandler`
  - Claude provider uses `--output-format stream-json` for structured events (tool calls,
    tool results, text deltas, thinking blocks)
  - Gemini and Codex providers emit text lines as `{ type: "text" }` events
  - New `AgentEvent` and `AgentEventHandler` types exported from `@sweny-ai/providers/coding-agent`
  - No breaking changes — `onEvent` is optional; omitting it preserves existing behaviour exactly

- 474589e: New observability providers: Prometheus and PagerDuty.

### Patch Changes

- 6a71f2a: Harden coding agent providers: stderr capture, timeout support, error logging.
  - Extract `spawnLines()` helper to `shared.ts` — eliminates duplicate spawn code across
    Claude, Gemini, and Codex providers
  - `spawnLines` captures stderr and forwards each line to the logger (previously discarded)
  - Event handler errors are logged via the logger instead of silently swallowed
  - Process killed by signal resolves with exit code -1 and logs the signal name
  - Add `timeoutMs` to `CodingAgentRunOptions` — passed through to both event and non-event paths
  - Add `timeoutMs` to `execCommand` for non-event mode too
  - Mock agent now lets `onEvent` handler errors propagate (aids test debugging)

## 0.2.2

### Patch Changes

- d552edb: Add `description` field to the `Issue` interface. This field was used internally by the engine but missing from the type definition, causing TypeScript errors when accessing `issue.description`.
