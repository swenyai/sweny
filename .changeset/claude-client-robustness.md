---
"@sweny-ai/core": minor
---

ClaudeClient robustness: timeout/abort, tool_result unwrap, JSON parsing

- `run`, `ask`, and `evaluate` accept optional `timeoutMs` and `signal`, wiring `options.abortController` and interrupting the stream via `try/finally` so a wedged subprocess or hung MCP server can no longer block forever. On timeout, `run` returns `status:"failed"` with a clear message; `ask`/`evaluate` keep their existing fallback shape with a distinct timeout log. Default behavior is unchanged when neither is provided.
- `parseToolResultContent` now unwraps a tool_result block array (e.g. `[{type:"text",text:"..."}]`) into concatenated text before JSON-parsing object/array payloads. String inputs behave exactly as before.
- `tryParseJSON` prefers the LAST fenced ```json block so an earlier injected fake block no longer wins, and flags (warns) when the parsed object does not conform to a supplied `outputSchema`.
- `evaluate` logs a distinct message on a non-success SDK subtype, separate from the ambiguous-answer warning, so an SDK failure is attributable.
