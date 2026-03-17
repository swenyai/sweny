---
title: MCP Servers
description: Extend the coding agent with additional tools via the Model Context Protocol — source control, observability, filesystem, and more.
---

MCP (Model Context Protocol) servers extend the coding agent with additional tools — letting it query GitHub, read Sentry events, or reach internal APIs without writing any provider code.

Pass servers via the `mcp-servers` Action input or the `SWENY_MCP_SERVERS` environment variable (CLI).

## Auto-injected servers

SWEny automatically injects MCP servers based on your configured providers — **no manual configuration needed** for the providers you're already using:

| Trigger | Server injected | Transport |
|---------|----------------|-----------|
| `source-control-provider: github` or `issue-tracker-provider: github-issues` | `@modelcontextprotocol/server-github` | stdio |
| `source-control-provider: gitlab` | `@modelcontextprotocol/server-gitlab` | stdio |
| `issue-tracker-provider: linear` | Linear MCP (`mcp.linear.app`) | HTTP |
| `observability-provider: datadog` | Datadog MCP (`mcp.datadoghq.com`) | HTTP |
| `observability-provider: sentry` | `@sentry/mcp-server` | stdio |
| `observability-provider: newrelic` | New Relic MCP (`mcp.newrelic.com`) | HTTP |

**Workspace tool integrations** (Category B — explicit opt-in via `workspace-tools`):

| `workspace-tools` value + env var | Server injected |
|----------------------------------|----------------|
| `slack` + `SLACK_BOT_TOKEN` | `@modelcontextprotocol/server-slack` |
| `notion` + `NOTION_TOKEN` | `@notionhq/notion-mcp-server` |
| `pagerduty` + `PAGERDUTY_API_TOKEN` | PagerDuty MCP (`mcp.pagerduty.com`) |
| `monday` + `MONDAY_TOKEN` | `@mondaydotcomorg/monday-api-mcp` |

The `mcp-servers` input is for servers **beyond** what's auto-injected — custom internal tools, additional GitHub integrations with different scopes, etc.

## Config schema

```json
{
  "<name>": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@some/mcp-server@latest"],
    "env": { "API_KEY": "..." }
  }
}
```

```json
{
  "<name>": {
    "type": "http",
    "url": "https://mcp.example.com/mcp",
    "headers": { "Authorization": "Bearer ..." }
  }
}
```

`type` defaults to `"stdio"` if `command` is set, `"http"` if `url` is set.

---

## Source Control

### GitHub — `@modelcontextprotocol/server-github`

Query pull requests, issues, CI run logs, and file contents during investigation.

**When to use**: Already auto-injected when `source-control-provider: github`. Add manually only if you need a different token scope (e.g., a PAT with `admin:org` for org-level queries).

**Capabilities**: list/read issues and PRs, search code, read file contents, list CI runs and their logs, create/update issues, create PRs.

```json
{
  "github": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@latest"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-token>" }
  }
}
```

**In `action.yml`**:
```yaml
mcp-servers: >-
  {"github":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github@latest"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"${{ secrets.GH_PAT }}"}}}
```

**In `.sweny.yml`**:
```yaml
mcp-servers-json: '{"github":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github@latest"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"ghp_..."}}}'
```

> Use a Personal Access Token (classic or fine-grained) with `repo` scope. In GitHub Actions you can fall back to the built-in token — though the built-in token cannot trigger downstream workflows.

---

## Observability

### Sentry — `@sentry/mcp-server`

Query Sentry issues, events, releases, and performance data. Official server maintained by Sentry.

**When to use**: Already auto-injected when `observability-provider: sentry`. Add manually if you need to query a second Sentry org or project.

**Capabilities**: list/search issues, read event detail and stacktraces, list releases, query performance transactions.

**Auth**: Create an internal integration token at **Settings → Developer Settings → Internal Integration** with at least `Issue & Event: Read` and `Project: Read` scopes.

```json
{
  "sentry": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@sentry/mcp-server@latest"],
    "env": {
      "SENTRY_AUTH_TOKEN": "<your-internal-integration-token>",
      "SENTRY_HOST": "https://sentry.io"
    }
  }
}
```

> For self-hosted Sentry, set `SENTRY_HOST` to your instance URL.

---

## General Purpose

### Filesystem — `@modelcontextprotocol/server-filesystem`

Read and write local files. Useful for giving the agent access to log files, config files, or artifacts produced by a previous CI step.

**Capabilities**: read/write/list files within whitelisted directories.

```json
{
  "filesystem": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem@latest", "/tmp"],
    "env": {}
  }
}
```

**In `action.yml`** (expose the workspace and `/tmp`):
```yaml
mcp-servers: >-
  {"filesystem":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem@latest","/tmp","${{ github.workspace }}"],"env":{}}}
```

> Only whitelist directories the agent should be able to read or modify. Each extra path argument adds a whitelisted root. In Actions the runner is ephemeral so broad workspace access is generally safe.

---

## Combining Multiple Servers

Pass a JSON object with multiple keys to equip the agent with several servers at once:

```yaml
mcp-servers: >-
  {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github@latest"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${{ secrets.GH_PAT }}" }
    },
    "sentry": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@sentry/mcp-server@latest"],
      "env": {
        "SENTRY_AUTH_TOKEN": "${{ secrets.SENTRY_AUTH_TOKEN }}",
        "SENTRY_HOST": "https://sentry.io"
      }
    }
  }
```

---

## Remote (HTTP) Servers

For cloud-hosted MCP servers that expose a Streamable HTTP endpoint:

```json
{
  "my-internal-tools": {
    "type": "http",
    "url": "https://mcp.internal.example.com/mcp",
    "headers": { "Authorization": "Bearer <token>" }
  }
}
```

HTTP servers are passed directly to the coding agent — SWEny does not proxy them. The agent must support Streamable HTTP transport (Claude Code does).

---

## Adding Your Own MCP Server

Any process that speaks the MCP stdio protocol can be used:

```json
{
  "my-tool": {
    "type": "stdio",
    "command": "/usr/local/bin/my-mcp-server",
    "args": ["--config", "/etc/my-tool.json"],
    "env": { "MY_API_KEY": "<key>" }
  }
}
```

See the [MCP specification](https://modelcontextprotocol.io) for the full protocol reference.
