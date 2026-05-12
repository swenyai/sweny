---
"@sweny-ai/core": patch
---

`--verbose` now prints tool calls for the agent's built-in tools (Bash,
Read, Edit, Write, etc.) in addition to skill-registered tools. Previously
the verbose observer only fired on `tool:call` / `tool:result` events,
which are emitted only for skill tools in `executor.ts`. Built-in tools
come via the Claude Code subprocess stream and land in `result.toolCalls`
on node:exit, so they never produced events.

Re-emission strategy: print all `result.toolCalls` on `node:exit` rather
than per-event. This trades liveness for completeness, which is the right
call for the debugging use case: you want the full picture after the node
runs, not partial visibility per call.
