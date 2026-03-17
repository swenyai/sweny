# Publish MCP Servers Reference to Docs Site

## Why this matters
`action.yml` line 301 says "See docs/mcp-servers.md for a full catalog" — this is a repo-root
path that GitHub renders but is NOT on docs.sweny.ai. Power users configuring custom MCP servers
hit a dead end. Also `docs/mcp-servers.md` has an incorrect claim: it says Datadog has no MCP
server, but the source auto-injects `https://mcp.datadoghq.com/api/unstable/mcp-server/mcp`.

## What to do
1. Create `packages/web/src/content/docs/providers/mcp-servers.md` — port content from
   `docs/mcp-servers.md` with these corrections:
   - Fix Datadog section: it DOES have an HTTP MCP server, auto-injected when you configure
     `observability-provider: datadog`. Note that manual config is NOT needed.
   - Add Linear, GitLab, New Relic to the "auto-injected" section (source: packages/cli/src/main.ts)
   - Add a clear "Auto-injected servers" section at the top explaining that provider-matched
     MCP servers inject automatically — users only need this page for ADDITIONAL servers
   - Keep: GitHub, Sentry, Filesystem sections
   - Keep: Combining Multiple Servers, Remote HTTP, Adding Your Own sections

2. Add to `packages/web/astro.config.mjs` sidebar under Provider Reference — BUT Provider
   Reference uses `autogenerate: { directory: "providers" }` so adding the file is sufficient
   (no sidebar change needed).

3. Update `action.yml` mcp-servers description to link to the docs site URL:
   Change "See docs/mcp-servers.md" → "See https://docs.sweny.ai/providers/mcp-servers/"

4. Add a link from `action/inputs.md` Workspace tools & MCP servers section to the new page.

## Key content for "Auto-injected servers" section
From packages/cli/src/main.ts buildAutoMcpServers():
- `github` — injected when sourceControlProvider=github OR issueTrackerProvider=github-issues
- `gitlab` — injected when sourceControlProvider=gitlab
- `linear` — HTTP, injected when issueTrackerProvider=linear (`https://mcp.linear.app/mcp`)
- `datadog` — HTTP, injected when observabilityProvider=datadog (`https://mcp.datadoghq.com/...`)
- `sentry` — stdio, injected when observabilityProvider=sentry
- `newrelic` — HTTP, injected when observabilityProvider=newrelic

Category B (workspace-tools):
- `slack` — injected when workspaceTools includes "slack" AND SLACK_BOT_TOKEN present
- `notion` — injected when workspaceTools includes "notion" AND NOTION_TOKEN present
- `pagerduty` — HTTP, injected when workspaceTools includes "pagerduty" AND PAGERDUTY_API_TOKEN present
- `monday` — injected when workspaceTools includes "monday" AND MONDAY_TOKEN present

## Related files
- `docs/mcp-servers.md` (repo root) — source content to port
- `packages/cli/src/main.ts` — auto-injection logic
- `action.yml` — description to update
- `packages/web/src/content/docs/action/inputs.md` — add link
