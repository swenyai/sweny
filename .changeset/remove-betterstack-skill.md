---
"@sweny-ai/core": minor
---

Remove custom BetterStack skill in favor of BetterStack MCP auto-injection

The hand-rolled BetterStack skill (Uptime API only) has been removed. BetterStack observability is now provided entirely through the official BetterStack MCP server, which covers both Uptime and Telemetry (logs/metrics) APIs. The MCP server is auto-injected when `observability-provider: betterstack` is configured.
