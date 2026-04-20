---
"@sweny-ai/core": minor
---

Add `requires` (pre-condition checks) and `retry` (node-local self-healing on verify failure) to workflow nodes.

`requires` is symmetric to `verify` but runs before the LLM, catching missing upstream context without burning tokens. Same path grammar; resolves against the cross-node context map. Configurable `on_fail: "fail" | "skip"`.

`retry` re-runs the node up to `max` additional times when verify fails. Three feedback modes: default ("Previous attempt failed verification..."), static (author-provided preamble), or autonomous — `{ auto: true }` invokes `claude.ask` to generate a diagnosis from the failure context, and `{ reflect: "..." }` lets the author shape the diagnosis prompt.

Adds one new method to the `Claude` interface: `ask({ instruction, context }): Promise<string>`. Implemented for `ClaudeClient` and `MockClaude`.

Each retry attempt is recorded in the trace with `retryAttempt`; a new `node:retry` observer event fires before each retry.
