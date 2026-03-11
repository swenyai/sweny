---
"@sweny-ai/providers": patch
---

Remove proof-of-concept MCP provider files (linear-mcp, slack-mcp, github-mcp).
These were exploratory and used the wrong abstraction pattern.
The MCP client wrapper (mcp/client.ts) is retained for future use.
Add @modelcontextprotocol/sdk as optional peer dependency.
