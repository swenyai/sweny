---
"@sweny-ai/core": minor
---

Move verify tool-name aliases from a hardcoded core table to per-skill metadata.

Previously core shipped a hardcoded alias table mapping first-party skill tool
names (e.g. `linear_create_issue`) to their Linear and GitHub MCP equivalents.
Every new MCP server or renamed provider tool required a core patch, and the
table silently omitted ambiguous names (e.g. `get_issue`, which multiple MCPs
expose), which meant the Apr 24 hotfix did not actually cover every failing
triage pattern in the field.

Each skill now owns its own aliases via `Skill.mcpAliases`:

```ts
mcpAliases: {
  linear_create_issue: ["save_issue"],
  linear_add_comment: ["save_comment"],
  linear_search_issues: ["list_issues"],
  linear_list_teams: ["list_teams"],
  linear_update_issue: ["save_issue"],
}
```

At execution time the executor unions the alias tables from every loaded
skill via `buildToolAliases(skills)` and passes the result to
`evaluateVerify`. Names claimed by more than one skill (the cross-provider
ambiguity case) are dropped from the table with a warning, so a Linear call
can never spuriously satisfy a GitHub verify rule or vice versa.

Core stays vendor-neutral. New providers become one-line additions to the
relevant skill, not core patches.

The public `checkAnyToolCalled` / `checkAllToolsCalled` / `checkNoToolCalled` /
`evaluateVerify` helpers now accept an optional `ToolAliases` parameter. When
omitted they fall back to strict name equality, which matches the behavior
expected by workflows that do not declare skills with aliases.
