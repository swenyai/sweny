---
"@sweny-ai/core": minor
---

Add `--verbose` to `sweny workflow run` (and `verbose: true` to the GitHub
Action). When set, the CLI prints every tool call's input and output inline
in a human-readable form (truncated to ~1200 chars per side; use `--stream`
for the full untruncated NDJSON).

Motivation: when a node fails or routes to `notify_halt`, the default human
output only shows `✓ node: success (N tool calls)`. The actual tool data
that drove the routing decision is invisible. `--verbose` makes it
debuggable from a CI log without re-running with `--stream` and post-
processing NDJSON.
