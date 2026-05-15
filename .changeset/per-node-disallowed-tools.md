---
"@sweny-ai/core": minor
---

Add per-node `disallowed_tools` to the workflow schema. The executor forwards
this list to the Claude Agent SDK's `disallowedTools` option, which removes
the named built-in tools (e.g. `Bash`, `WebFetch`, `WebSearch`) from the
model's context entirely for the duration of that node.

This is the foundational mechanism for tool-enforcing per-node scope
boundaries. As a first application, the `triage` and `implement` workflows
now lock `WebFetch` + `WebSearch` off the implement node so the agent
cannot drift off-task into external research mid-implementation. `Bash`
remains available because the implement node legitimately needs it for
`git add` / `git commit` and to run the project's test command; pattern-
based restriction of `Bash` invocations (e.g. blocking `gh pr create` and
`git push`) belongs to a separate follow-up that wires the SDK's
`canUseTool` callback to a per-node Bash deny pattern list.
