# Task 13: MCP Server Catalog

## Context

SWEny now supports passing MCP servers to the coding agent via `mcp-servers` (action)
or `mcp-servers-json` / `SWENY_MCP_SERVERS` (CLI). The feature is wired end-to-end but
there's no documentation showing users which MCP servers are useful and how to configure
them for their stack.

The goal: a practical catalog of MCP servers that pair well with SWEny, with copy-paste
JSON configs for each.

## What to Build

### 1. `docs/mcp-servers.md` — The Catalog

A single markdown page with sections per MCP server category. Each entry should have:
- What it does (1 sentence)
- Install/run command
- The JSON snippet to paste into `mcp-servers` action input or `SWENY_MCP_SERVERS`
- What capabilities it gives the agent

#### Servers to Document (minimum)

**Source Control**
- `github/github-mcp-server` — query PRs, issues, CI runs, file contents
  - Transport: stdio via `npx` or Docker
  - Env: `GITHUB_PERSONAL_ACCESS_TOKEN`

**Issue Tracking**
- Linear MCP (if available) — query/update Linear issues directly

**Observability** (if MCP servers exist)
- Datadog MCP — query metrics, logs, incidents
- Sentry MCP — query issues, events, releases

**General Purpose**
- `@modelcontextprotocol/server-filesystem` — read local files (useful for log files)
- `@modelcontextprotocol/server-fetch` — make HTTP requests (query internal APIs)

### 2. Update `action.yml` description for `mcp-servers`

The current description is minimal. Expand it with a concrete multi-server example
and a link to the catalog doc.

### 3. Update `.sweny.yml` STARTER_CONFIG comment

In `packages/cli/src/config-file.ts`, the `STARTER_CONFIG` has a commented-out
`mcp-servers-json` line. Expand the comment to show a real GitHub MCP example.

## Research Required

Before writing, verify actual package names and transports:
```bash
# Check the official GitHub MCP server
# https://github.com/github/github-mcp-server

# Check modelcontextprotocol reference servers
# https://github.com/modelcontextprotocol/servers
```

## Format for Each Entry

```markdown
### GitHub — `github/github-mcp-server`

Query pull requests, issues, CI run logs, and file contents directly during investigation.

**When to use**: Always. Gives the agent context about recent PRs, failing CI runs,
and the actual code that may be causing errors.

**Config**:
\`\`\`json
{
  "github": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@latest"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-token>" }
  }
}
\`\`\`

**In action.yml**:
\`\`\`yaml
mcp-servers: >-
  {"github":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github@latest"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"${{ secrets.GH_PAT }}"}}}
\`\`\`

**In .sweny.yml**:
\`\`\`yaml
mcp-servers-json: '{"github":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github@latest"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"ghp_..."}}}'
\`\`\`
```

## Verification

Review for accuracy:
- JSON is valid and matches `MCPServerConfig` type in `packages/providers/src/mcp/client.ts`
- `type`, `command`, `args`, `env`, `url`, `headers` are the only valid fields
- Package names and versions are real and available on npm

## No Changeset Required

Docs-only (plus minor comment update in `config-file.ts` which is a private package).

## Commit Message

```
docs: add MCP server catalog with copy-paste configs for GitHub, Datadog, Sentry
```
