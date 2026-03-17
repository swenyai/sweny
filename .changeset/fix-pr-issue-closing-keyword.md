---
"@sweny-ai/engine": patch
---

Fix PR body always including issue closing keyword — don't rely on Claude to write it

When `issue-tracker-provider` is `github-issues`, the PR body now always ends with
`Closes #N`, which causes GitHub to auto-close the issue when the PR merges and
creates the "Development" sidebar link. Previously the closing keyword was part of
the prompt template Claude was asked to reproduce, but Claude would often omit it.

The same footer fix applies to Linear and Jira (linked reference), and for the
fallback body path (no `pr-description.md` generated).
