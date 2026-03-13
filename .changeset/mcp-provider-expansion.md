---
"@sweny-ai/cli": minor
---

Expand MCP auto-injection with four additional providers: GitLab, Sentry, Slack, and Notion.

**New Category A injections** (triggered by existing provider config, zero new credentials required):
- `source-control-provider: gitlab` → auto-injects `@modelcontextprotocol/server-gitlab` with `GITLAB_PERSONAL_ACCESS_TOKEN`; self-hosted instances get `GITLAB_API_URL` set automatically
- `observability-provider: sentry` → auto-injects `@sentry/mcp-server` with `SENTRY_AUTH_TOKEN`; self-hosted Sentry gets `SENTRY_HOST` extracted from `sentry-base-url`

**New Category B injections** (triggered by env var presence, no provider config change needed):
- `SLACK_BOT_TOKEN` → auto-injects `@modelcontextprotocol/server-slack`, giving the agent full bidirectional Slack API access (separate from the one-way notification webhook)
- `NOTION_API_KEY` → auto-injects `@notionhq/notion-mcp-server`, giving the agent access to runbooks, on-call docs, and incident templates

Total auto-injected MCP servers: GitHub, GitLab, Linear, Datadog, Sentry, Slack, Notion (7).

User-supplied `mcp-servers` config always wins on key conflict.
