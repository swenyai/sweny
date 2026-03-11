---
"@sweny-ai/providers": patch
---

Harden coding agent providers and fix Claude stream-json event parsing.

- Extract `spawnLines()` to `shared.ts` — removes duplicated spawn code across Claude, Gemini, Codex
- stderr now forwarded to logger in event mode (was silently discarded)
- Event handler errors logged instead of swallowed
- Process killed by signal resolves with -1 and logs signal name
- `timeoutMs` added to `CodingAgentRunOptions` and `ExecOptions`
- Stateful Claude event parser (`makeClaudeEventParser`) — maintains tool_use_id→name map
  so tool_result events carry human-readable tool names, not opaque IDs
- Add `--verbose` flag required by Claude Code CLI for `--output-format stream-json`
- Mock agent propagates `onEvent` errors so tests surface real failures
