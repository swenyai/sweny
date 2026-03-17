---
"@sweny-ai/engine": patch
---

Prevent coding agent from creating PRs directly during implement-fix step

The implement prompt now explicitly instructs the agent not to run `gh pr create`
or push the branch — both are handled by subsequent workflow steps. Previously the
agent would sometimes open a PR itself, bypassing the `create-pr` step that appends
the `Closes #N` keyword and links the PR to the issue tracker.
