---
"@sweny-ai/providers": patch
---

Harden coding agent providers: stderr capture, timeout support, error logging.

- Extract `spawnLines()` helper to `shared.ts` — eliminates duplicate spawn code across
  Claude, Gemini, and Codex providers
- `spawnLines` captures stderr and forwards each line to the logger (previously discarded)
- Event handler errors are logged via the logger instead of silently swallowed
- Process killed by signal resolves with exit code -1 and logs the signal name
- Add `timeoutMs` to `CodingAgentRunOptions` — passed through to both event and non-event paths
- Add `timeoutMs` to `execCommand` for non-event mode too
- Mock agent now lets `onEvent` handler errors propagate (aids test debugging)
