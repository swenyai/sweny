---
"@sweny-ai/core": minor
---

Remove custom BetterStack skill, inject MCP on token presence, add source scoping

- **Removed custom BetterStack skill** (Uptime API only) in favor of the official BetterStack MCP server which covers both Uptime and Telemetry APIs.
- **BetterStack MCP now injects whenever `BETTERSTACK_API_TOKEN` is set**, not only when betterstack is the primary observability provider. This enables using BetterStack logs alongside another provider like Sentry.
- **Added `betterstack-source-id` and `betterstack-table-name` inputs** to scope log queries to a specific BetterStack source. Values are passed to the agent context so it knows which source to query.
