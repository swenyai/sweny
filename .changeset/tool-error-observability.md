---
"@sweny-ai/core": patch
---

Surface tool errors in the CI log stream and add retry blocks to the bundled
triage workflow's action-taking nodes.

Before this, when a tool returned an error during a node turn, the error body
was captured onto the `ToolCall.output.error` field for in-memory verify
evaluation but never written to the log stream. The only CI-visible signal
was the downstream `verify failed: any_tool_called` message, which names the
tool but gives no hint as to *why* it failed. Every triage postmortem on a
tool failure became a diagnostic wall: "the tool was called and errored; no
idea what it said."

The `ClaudeClient` tool-result handler now calls `logger.warn` with the tool
name and a short, single-line summary of the error body (collapsed
whitespace, capped at 300 chars). The full parsed payload is still attached
to the `ToolCall` for verify and downstream consumers — this is only about
observability.

Also adds `retry: { max: 1, instruction: { auto: true } }` to the `create_issue`
and `create_pr` nodes in the bundled triage workflow. These are single
action-taking nodes most exposed to transient provider errors (GitHub or
Linear rate limits, 422s on bad inputs, network blips). One auto-reflection
retry gives the agent a chance to adjust its inputs based on the error it
just saw — previously a single failure killed the whole pipeline before
the real fix (which had already been written to a branch by the `implement`
node) ever got a PR opened for it.
