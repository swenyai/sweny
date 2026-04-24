---
"@sweny-ai/core": patch
---

Fix verify `any_tool_called` / `all_tools_called` / `no_tool_called` to treat MCP tools as equivalent to first-party skill tools.

When an external MCP server is wired alongside a built-in skill (e.g. the official Linear HTTP MCP server + the `linear` skill, or GitHub MCP + the `github` skill), the agent may invoke either the skill tool (`linear_search_issues`) or the MCP tool (`list_issues`). Both perform the same work against the same backend, but verify rules referencing one name would fail when the agent picked the other. Triage workflows in production hit this as a consistent false-negative failure at the `investigate` and `create_issue` nodes.

Verify now expands each referenced tool name through an alias table covering the Linear and GitHub MCP equivalents, so either call satisfies the rule. Only unambiguous names are aliased — tools like `get_issue` that exist on multiple MCP servers are deliberately excluded to prevent cross-provider spillover.
