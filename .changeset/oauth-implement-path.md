---
"@sweny-ai/core": minor
---

feat: OAuth auth priority, implement path in triage workflow, MCP auto-injection in CLI

- OAuth token now takes priority over API key in Claude Code subprocess (prevents .env pollution)
- Added `allowDangerouslySkipPermissions` for headless Claude Code execution
- Triage workflow: added implement → create_pr nodes with routing based on fix_complexity
- Skip node: +1 comments on existing duplicate issues
- CLI: wired buildAutoMcpServers() and provider context injection
- Added buildProviderContext() for dynamic provider/MCP context in node instructions
