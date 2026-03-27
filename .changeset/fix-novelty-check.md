---
"@sweny-ai/core": patch
---

Fix novelty check lost in v3→v4 refactor

- **Triage workflow**: `investigate` node now explicitly searches for existing issues before declaring novelty. `create_issue` node searches before creating and +1's existing issues instead of duplicating.
- **GitHub skill**: Add `github_add_comment` tool for +1'ing existing issues.
- **Linear skill**: Add `linear_add_comment` tool for +1'ing existing issues.
- **Investigate node**: Now includes `linear` skill alongside `github` for cross-tracker search.
