---
"@sweny-ai/cli": patch
---

Remove `asana` from supported workspace tools — no auto-injection implementation exists (no stable HTTP MCP endpoint). Users can still configure Asana via `mcp-servers-json` manually.
