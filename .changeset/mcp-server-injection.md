---
"@sweny-ai/providers": minor
---

Add `mcpServers` injection to coding agent providers.

`CodingAgentRunOptions` now accepts `mcpServers?: Record<string, MCPServerConfig>`. When provided, all three coding agents (Claude Code, OpenAI Codex, Gemini) serialize the config to a temp JSON file and pass `--mcp-config <path>` to the agent CLI. The agent receives all configured MCP tools during its reasoning session. Temp file is cleaned up after the agent exits.

`MCPServerConfig` extended to support both transports:
- `type: "stdio"` — local pre-installed binary (`command`, `args`, `env`)
- `type: "http"` — remote Streamable HTTP server (`url`, `headers`)

Type defaults to `"http"` when `url` is set, `"stdio"` when `command` is set.
