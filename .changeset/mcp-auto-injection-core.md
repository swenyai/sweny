---
"@sweny-ai/core": minor
---

Add `buildAutoMcpServers()` and MCP types to core. Auto-configures well-known MCP servers (GitHub, GitLab, Linear, Jira, Datadog, Sentry, New Relic, Better Stack, Slack, Notion, PagerDuty, Monday, Asana) based on configured providers and workspace tools. Extracted from the action package so both CLI and action can share the logic.
