---
title: MCP Servers
description: Auto-injection and custom MCP server configuration.
---

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) is a standard for connecting tools to AI models. SWEny uses MCP to give Claude access to external services beyond the built-in skills — things like full GitHub repository search, Sentry issue analysis, or Slack channel history.

SWEny automatically injects the right MCP servers based on your configuration. You can also add custom servers for services SWEny doesn't have built-in skills for.

## Auto-injection

When you configure a provider (source control, issue tracker, observability), SWEny checks whether that provider has a well-known MCP server and injects it automatically. No manual setup required.

### Category A — Provider-triggered

These servers are injected when the corresponding provider is configured and the required credentials are present.

| Provider config | MCP server injected | Transport | Credential |
|----------------|---------------------|-----------|------------|
| `source-control-provider: github` | `@modelcontextprotocol/server-github` | stdio | `GITHUB_TOKEN` |
| `source-control-provider: gitlab` | `@modelcontextprotocol/server-gitlab` | stdio | `GITLAB_TOKEN` |
| `issue-tracker-provider: linear` | Linear MCP (`mcp.linear.app`) | HTTP | `LINEAR_API_KEY` |
| `issue-tracker-provider: jira` | `@sooperset/mcp-atlassian` | stdio | `JIRA_URL` + `JIRA_EMAIL` + `JIRA_API_TOKEN` |
| `observability-provider: datadog` | Datadog MCP (`mcp.datadoghq.com`) | HTTP | `DD_API_KEY` + `DD_APP_KEY` |
| `observability-provider: sentry` | `@sentry/mcp-server` | stdio | `SENTRY_AUTH_TOKEN` |
| `observability-provider: newrelic` | New Relic MCP (`mcp.newrelic.com`) | HTTP | `NEW_RELIC_API_KEY` |
| `observability-provider: betterstack` | BetterStack MCP (`mcp.betterstack.com`) | HTTP | `BETTERSTACK_API_TOKEN` |

:::note[Skills + MCP]
Built-in skills and auto-injected MCP servers are complementary. The `sentry` skill provides tools like `sentry_list_issues` and `sentry_get_issue` via the core tool system. The Sentry MCP server gives Claude additional capabilities from the official Sentry integration. Both are available to Claude simultaneously.
:::

### Category B — Workspace tools (opt-in)

These servers require explicit opt-in via the `workspace-tools` action input (or `--workspace-tools` CLI flag). They are injected only when both the opt-in is present and the required credential is set.

| Workspace tool | MCP server injected | Transport | Credential |
|---------------|---------------------|-----------|------------|
| `slack` | `@modelcontextprotocol/server-slack` | stdio | `SLACK_BOT_TOKEN` |
| `notion` | `@notionhq/notion-mcp-server` | stdio | `NOTION_TOKEN` |
| `pagerduty` | PagerDuty MCP (`mcp.pagerduty.com`) | HTTP | `PAGERDUTY_API_TOKEN` |
| `monday` | `@mondaydotcomorg/monday-api-mcp` | stdio | `MONDAY_TOKEN` |
| `asana` | `asana-mcp` | stdio | `ASANA_ACCESS_TOKEN` |

Enable workspace tools in the GitHub Action:

```yaml
- uses: swenyai/triage@v1
  with:
    workspace-tools: "slack,notion"
    # ... other inputs
  env:
    SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
    NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
```

Or in the CLI:

```bash
sweny triage --workspace-tools slack,notion
```

## Custom MCP servers

For services without built-in support, pass custom MCP servers via the `mcp-servers-json` action input (JSON string) or CLI config.

### Action input

```yaml
- uses: swenyai/triage@v1
  with:
    mcp-servers-json: |
      {
        "my-database": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@my-org/db-mcp-server"],
          "env": { "DATABASE_URL": "${{ secrets.DATABASE_URL }}" }
        }
      }
```

### Server config format

Each server is a key-value pair where the key is a name and the value is an `McpServerConfig`:

```json
{
  "server-name": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@some-org/mcp-server@latest"],
    "env": { "API_KEY": "..." }
  }
}
```

For HTTP transport (preferred for performance when available):

```json
{
  "server-name": {
    "type": "http",
    "url": "https://mcp.example.com/mcp",
    "headers": { "Authorization": "Bearer ..." }
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"stdio"` or `"http"` | Transport protocol |
| `command` | string | Executable to run (stdio only) |
| `args` | string[] | Arguments to pass (stdio only) |
| `url` | string | Server endpoint (HTTP only) |
| `headers` | object | HTTP headers (HTTP only) |
| `env` | object | Environment variables passed to the process (stdio only) |

:::note[Transport preference]
HTTP transport is preferred over stdio when available. HTTP servers start faster (no process spawn), support connection pooling, and avoid the overhead of stdin/stdout serialization. Most newer MCP servers (Linear, Datadog, PagerDuty, New Relic, BetterStack) offer HTTP endpoints.
:::

## Conflict resolution

If a custom server has the same key as an auto-injected server, **the custom server wins**. This lets you override auto-injection when you need a specific version or configuration:

```yaml
mcp-servers-json: |
  {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github@0.6.0"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${{ secrets.GH_TOKEN }}" }
    }
  }
```

This replaces the auto-injected GitHub MCP server with a pinned version.

## How it works internally

The `buildAutoMcpServers()` function in `@sweny-ai/core` takes the current provider configuration and credentials, builds the auto-injection map, then merges user-supplied servers on top:

```
auto-injected servers (from provider config)
  + workspace tool servers (from workspace-tools input)
    + user-supplied servers (from mcp-servers-json input)  ← wins on conflict
      = final MCP server map passed to Claude Code
```

The merged map is passed to the Claude Code SDK's `query()` function as the `mcpServers` option. Claude Code manages the MCP server lifecycle — starting stdio processes, connecting to HTTP endpoints, and routing tool calls.
