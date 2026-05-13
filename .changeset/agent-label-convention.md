---
"@sweny-ai/core": minor
---

Standardize the labels SWEny applies to issues and PRs it files. Old default
was a single `sweny` label; new default is two-tier: `sweny` (provenance) +
`agent` (who) + role tag (`task`, `feature`, or `triage`).

- `github_create_pr` now accepts an optional `labels` array. Default when
  omitted is `["sweny", "agent"]`; callers can pass an explicit set.
- New `linear_list_labels` skill (id, name, color, team — workspace-wide or
  scoped to a team) so workflows can resolve label names to `labelIds` at
  runtime. Aliases to the Linear MCP `list_issue_labels` tool.
- `triage` workflow: file Linear / GitHub issues with
  `["sweny", "agent", "triage"]` and PRs with the same set.
- `implement` workflow: open PRs with `["sweny", "agent", "task"]` (or
  `["sweny", "agent", "feature"]` for feature requests).
