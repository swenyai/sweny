---
"@sweny-ai/cli": minor
---

Auto-inject MCP servers for configured providers — no user-facing MCP configuration required.

When you configure `source-control-provider: github`, `issue-tracker-provider: linear`, or `observability-provider: datadog`, SWEny now automatically injects the corresponding MCP server into the coding agent's tool set. Linear and Datadog use HTTP transport (no local installation). GitHub uses the official `@modelcontextprotocol/server-github` package. User-supplied `mcp-servers` override auto-injected entries.

Also extends GitHub MCP injection to `issue-tracker-provider: github-issues`.
