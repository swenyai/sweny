# MCP Server Catalog

MCP (Model Context Protocol) servers extend the coding agent with additional tools — letting it query
GitHub, read log files, or reach internal APIs without you writing any provider code.

Pass servers via the `mcp-servers` action input or the `SWENY_MCP_SERVERS` environment variable (CLI).
The value is a JSON object where each key is a name you choose and each value is an
[`MCPServerConfig`](../packages/providers/src/mcp/client.ts):

```
{
  "<name>": {
    "type": "stdio" | "http",   // defaults: "stdio" if command set, "http" if url set
    "command": "...",            // stdio: binary to spawn
    "args": ["..."],             // stdio: arguments
    "env": { "KEY": "val" },    // stdio: extra env vars (merged with process env)
    "url": "https://...",        // http: remote server URL
    "headers": { "Authorization": "Bearer ..." }  // http: request headers
  }
}
```

---

## Source Control

### GitHub — `@modelcontextprotocol/server-github`

Query pull requests, issues, CI run logs, and file contents directly during investigation.

**When to use**: Always on GitHub-hosted repos. Gives the agent context about recent PRs,
failing CI runs, and the actual code that may be causing errors.

**Capabilities**: list/read issues and PRs, search code, read file contents, list CI runs and
their logs, create/update issues, create PRs.

**Config**:
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

> **Note**: Use a Personal Access Token (classic or fine-grained) with `repo` scope.
> In GitHub Actions you can fall back to the built-in token:
> `"${{ secrets.GH_PAT || github.token }}"` — though the built-in token cannot trigger
> downstream workflows.

---

## Observability

### Sentry — `@sentry/mcp-server`

Query Sentry issues, events, releases, and performance data. Official server maintained by Sentry.

**When to use**: When `observability-provider` is `sentry`. Lets the agent dig into individual
error events, stacktraces, and release history beyond what the native Sentry provider exposes.

**Capabilities**: list/search issues, read event detail and stacktraces, list releases, query
performance transactions, manage alerts.

**Auth**: Create an internal integration token at **Settings → Developer Settings → Internal
Integration** with at least `Issue & Event: Read` and `Project: Read` scopes.

**Config**:
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

**In `action.yml`**:
```yaml
mcp-servers: >-
  {"sentry":{"type":"stdio","command":"npx","args":["-y","@sentry/mcp-server@latest"],"env":{"SENTRY_AUTH_TOKEN":"${{ secrets.SENTRY_AUTH_TOKEN }}","SENTRY_HOST":"https://sentry.io"}}}
```

> **Note**: For self-hosted Sentry, set `SENTRY_HOST` to your instance URL.

---

### Datadog — no official MCP server yet

Datadog does not currently publish an official MCP server. Use the built-in
`observability-provider: datadog` which queries the Datadog REST API natively.
Set `DD_API_KEY` and `DD_APP_KEY` via secrets.

> **If this changes**: watch [github.com/DataDog](https://github.com/DataDog) for an official
> release. Do not use community packages in production pipelines — they are not maintained by
> Datadog and may not keep up with API changes.

---

## General Purpose

### Filesystem — `@modelcontextprotocol/server-filesystem`

Read and write local files. Useful for giving the agent access to log files, config files,
or other local artifacts produced by your build or CI pipeline.

**When to use**: When you want the agent to read a file that isn't fetched through a provider —
for example, a structured log file written to disk by a previous CI step.

**Capabilities**: read/write/list files within whitelisted directories.

**Config** (read-only access to `/tmp`):
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

> **Security note**: Only whitelist directories the agent should be able to read or modify.
> Each extra path argument adds a whitelisted root. In Actions the runner is ephemeral, so
> broad workspace access is generally safe.

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

For cloud-hosted MCP servers that expose a Streamable HTTP endpoint, use `type: "http"`:

```json
{
  "my-internal-tools": {
    "type": "http",
    "url": "https://mcp.internal.example.com/sse",
    "headers": { "Authorization": "Bearer <token>" }
  }
}
```

HTTP servers are passed directly to the coding agent — SWEny does not proxy them.
The agent must support Streamable HTTP transport (Claude Code does).

---

## Adding Your Own MCP Server

Any process that speaks the MCP stdio protocol can be used. Point `command` at the binary:

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

See the [MCP specification](https://modelcontextprotocol.io) and the
[`MCPServerConfig` type](../packages/providers/src/mcp/client.ts) for the full field reference.
