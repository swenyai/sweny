---
"@sweny-ai/cli": minor
---

Expand MCP auto-injection from 3 to 10 providers; add `workspace-tools` explicit opt-in; fix two env var names.

**New `workspace-tools` config option** — Category B MCP servers now require explicit declaration in addition to credential env vars. Both conditions must be met for injection to occur.

CLI: `--workspace-tools slack,notion` or `.sweny.yml` key `workspace-tools`
Action: `workspace-tools: "slack,notion"` input

**New Category A injections** (from existing provider config — zero new credentials):
- `source-control-provider: gitlab` → `@modelcontextprotocol/server-gitlab`; self-hosted instances get `GITLAB_API_URL` automatically
- `observability-provider: sentry` → `@sentry/mcp-server` with `SENTRY_ACCESS_TOKEN`; self-hosted Sentry gets `SENTRY_HOST` from `sentry-base-url`
- `observability-provider: newrelic` → `https://mcp.newrelic.com/mcp/` (HTTP); EU region auto-routes to `https://mcp.eu.newrelic.com/mcp/`

**New Category B injections** (requires `workspace-tools` declaration AND credential env var):
- `workspace-tools: slack` + `SLACK_BOT_TOKEN` → `@modelcontextprotocol/server-slack` (full bidirectional API; separate from notification webhook)
- `workspace-tools: notion` + `NOTION_TOKEN` → `@notionhq/notion-mcp-server` (runbooks, on-call docs)
- `workspace-tools: pagerduty` + `PAGERDUTY_API_TOKEN` → `https://mcp.pagerduty.com/mcp` (HTTP)
- `workspace-tools: monday` + `MONDAY_TOKEN` → `@mondaydotcomorg/monday-api-mcp`

**Bug fixes:**
- Sentry: corrected env var from `SENTRY_AUTH_TOKEN` to `SENTRY_ACCESS_TOKEN` (what `@sentry/mcp-server` actually reads)
- Notion: corrected env var from `NOTION_API_KEY` to `NOTION_TOKEN`; `NOTION_API_KEY` still accepted as fallback

Full list of auto-injected MCP servers: GitHub, GitLab, Linear, Datadog, Sentry, New Relic, Slack, Notion, PagerDuty, Monday.com (10 total).

User-supplied `mcp-servers` config always wins on key conflict.
