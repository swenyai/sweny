---
"@sweny-ai/providers": minor
---

Add Sentry MCP server support. The Sentry observability provider now implements `getMcpServers()`, which auto-injects `@sentry/mcp-server` into every agent run when Sentry credentials are present. This gives the coding agent direct access to all 16+ Sentry MCP tools (issue analysis, Seer root-cause analysis, cross-file search, release tracking, etc.) in addition to the existing REST API access.

The `ObservabilityProvider` interface gains an optional `getMcpServers?(): Record<string, MCPServerConfig>` method that providers can implement to contribute MCP servers to agent runs.
