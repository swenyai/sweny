---
"@sweny-ai/core": minor
---

Add --stream flag and live progress display for workflow execution

- **`--stream` flag**: All commands (triage, implement, workflow run) now support `--stream` which outputs NDJSON ExecutionEvents to stdout. This is the foundation for Studio live visualization and automation consumers.
- **`node:progress` event**: New ExecutionEvent type that surfaces Claude's internal tool activity (tool names, elapsed times, summaries) through the observer pattern.
- **Live progress UX**: Triage command shows a multi-line activity block with spinner, elapsed time, and last 3 tool activities — updates in-place on TTY.
- **SDK streaming**: ClaudeClient now handles `tool_progress` and `tool_use_summary` SDK events, piping them through `onProgress` callbacks to the executor and observer chain.
