---
"@sweny-ai/providers": minor
"@sweny-ai/cli": patch
---

Add Better Stack Telemetry as an observability provider.

Token-based auth (`BETTERSTACK_API_TOKEN`) works in GitHub Actions without OAuth. The provider auto-injects the Better Stack MCP server (`https://mcp.betterstack.com`) so the coding agent has full ClickHouse SQL access to logs, metrics, spans, and error tracking.
