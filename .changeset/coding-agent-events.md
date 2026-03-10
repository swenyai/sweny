---
"@sweny-ai/providers": minor
---

Add optional `onEvent` streaming callback to coding agent provider configs.

- `ClaudeCodeConfig`, `GoogleGeminiConfig`, `OpenAICodexConfig`, `MockCodingAgentConfig`
  all accept `onEvent?: AgentEventHandler`
- Claude provider uses `--output-format stream-json` for structured events (tool calls,
  tool results, text deltas, thinking blocks)
- Gemini and Codex providers emit text lines as `{ type: "text" }` events
- New `AgentEvent` and `AgentEventHandler` types exported from `@sweny-ai/providers/coding-agent`
- No breaking changes — `onEvent` is optional; omitting it preserves existing behaviour exactly
