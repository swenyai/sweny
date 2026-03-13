---
"@sweny-ai/cli": patch
"@sweny-ai/providers": patch
---

Fix auto-injected MCP server configuration and S3 client initialization

- Fix GitHub MCP server env var: use `GITHUB_PERSONAL_ACCESS_TOKEN` (required by `@modelcontextprotocol/server-github`) instead of `GITHUB_TOKEN`
- Remove Datadog MCP auto-injection (endpoint was at an unstable `/unstable` path)
- Fix S3 client lazy-init race condition: use a shared `_clientPromise` instead of `_client` so concurrent calls before the first init share one promise instead of creating multiple clients
- Add smoke test coverage verifying that method calls (not just constructors) trigger lazy peer dep imports
