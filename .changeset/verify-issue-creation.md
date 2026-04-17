---
"@sweny-ai/core": minor
---

Add node-level `verify` post-conditions and close Linear silent-success gap

- **Schema / executor**: Nodes may now declare a `verify` block (e.g. `any_tool_called: [...]`) that the executor checks after the LLM returns. If the declared tools were never successfully invoked, the node is marked `failed` and downstream nodes do not run with hallucinated output. Keeps the executor generic — the workflow YAML declares what must hold.
- **Linear skill**: `linear_create_issue` and `linear_update_issue` now throw when Linear returns `success: false` or omits the `identifier`. Prevents agents from proceeding with a synthesized identifier when the GraphQL mutation silently failed.
- **Triage workflow**: `create_issue` node now (a) declares `verify.any_tool_called: [linear_create_issue, github_create_issue]`, (b) requires `issueIdentifier` to match the Linear/Jira-style `^[A-Z][A-Z0-9]*-\d+$` pattern, and (c) explicitly forbids fabricating an identifier from a Sentry short-ID, commit SHA, or alert payload. `implement` picks up a precondition gate that STOPs if the identifier is malformed, preventing branch names like `off-sentry-7348174237-...` that fail downstream CI branch-naming rules.
