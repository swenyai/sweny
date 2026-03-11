---
"@sweny-ai/providers": minor
---

Add MCP-backed provider adapters: `linearMCP`, `slackMCP`, `githubMCP`.
These wrap `@modelcontextprotocol/sdk` MCP servers and satisfy the standard
provider interfaces. Note: `githubMCP` satisfies `RepoProvider` only —
local git operations (`GitProvider`) cannot be served from a remote MCP server.
Also exports `MCPClient` and `MCPServerConfig` from `@sweny-ai/providers/mcp`.
