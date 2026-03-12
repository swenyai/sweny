---
"@sweny-ai/engine": minor
---

Add `mcpServers` to `TriageConfig`, `ImplementConfig`, and `SharedNodeConfig`. When provided, MCP server configs are forwarded to every `codingAgent.run()` call (investigate, implement-fix, create-pr, notify), enabling the coding agent to use MCP tools throughout the full recipe execution.
