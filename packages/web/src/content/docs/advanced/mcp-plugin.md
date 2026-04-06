---
title: MCP Server Plugin
description: Use SWEny from Claude Code or Claude Desktop as an MCP server.
---

The `@sweny-ai/mcp` package runs SWEny as a [Model Context Protocol](https://modelcontextprotocol.io/) server, letting you trigger workflows directly from Claude Code or Claude Desktop.

Instead of switching to your terminal to run `sweny triage`, Claude can call the tool itself — delegating complex multi-step work to SWEny's DAG executor while you stay in your conversation.

## Quick start — Claude Code Plugin

The easiest way to use SWEny from Claude Code is to install the plugin:

```
/plugin install https://github.com/swenyai/sweny
```

This gives you:
- **Slash commands** — `/sweny:triage`, `/sweny:implement`, `/sweny:e2e-run`, and 8 more
- **MCP tools** — Claude can autonomously list and run workflows
- **Startup hook** — verifies your credentials on session start
- **Isolated agent** — long-running workflows execute in a forked context

### Manual MCP setup

If you prefer to configure just the MCP server without the full plugin:

## Why use SWEny as an MCP server?

Claude Code runs everything in a single conversation context. For complex tasks, that context gets bloated and unfocused. SWEny's DAG executor solves this by splitting work into nodes — each node gets a focused context window with only the inputs it needs.

| Task type | Best approach |
|-----------|--------------|
| Simple, single-step tasks | Claude Code handles directly |
| Complex multi-step workflows | Claude delegates to SWEny via MCP |

SWEny handles the structured orchestration — conditional routing, scoped tool access, structured output schemas — that a single conversation can't do reliably.

## Setup

### Claude Code

Add to `.claude/settings.json` in your project:

```json
{
  "mcpServers": {
    "sweny": {
      "command": "npx",
      "args": ["-y", "@sweny-ai/mcp"]
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sweny": {
      "command": "npx",
      "args": ["-y", "@sweny-ai/mcp"]
    }
  }
}
```

### Prerequisites

- A `.sweny.yml` config file in the working directory (run `sweny init` to create one)
- Credentials for your configured providers set via environment variables or `.env`
- `@sweny-ai/core` installed (provides the `sweny` CLI binary)

## Available tools

### `sweny_list_workflows`

Lists built-in workflows (triage, implement, seed-content) and any custom workflows found in `.sweny/workflows/*.yml`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cwd` | string | no | Working directory to search. Defaults to the server's working directory. |

**Example response:**

```json
[
  {
    "id": "triage",
    "name": "Triage",
    "description": "Investigate alerts and create issues or PRs",
    "nodeCount": 8,
    "source": "builtin"
  },
  {
    "id": "implement",
    "name": "Implement",
    "description": "Pick up an issue and implement a fix",
    "nodeCount": 5,
    "source": "builtin"
  }
]
```

### `sweny_run_workflow`

Executes a triage or implement workflow by spawning the `sweny` CLI. Returns structured JSON results when the workflow completes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workflow` | `"triage"` or `"implement"` | yes | Which workflow to run |
| `input` | string | for implement | Issue ID or URL (required for implement, ignored for triage) |
| `cwd` | string | no | Working directory containing `.sweny.yml` |
| `dryRun` | boolean | no | Skip side effects — investigate but don't create issues/PRs |

:::note[Execution time]
Workflows run a full DAG with multiple Claude invocations under the hood. Expect triage to take 2-5 minutes and implement to take 3-10 minutes depending on complexity. The MCP server enforces a 10-minute timeout.
:::

## How it works

When Claude calls `sweny_run_workflow`, the MCP server:

1. **Spawns a separate `sweny` CLI process** — this avoids recursion (the MCP server runs inside Claude Code, but the workflow spawns its own Claude Code instance)
2. **Passes `--json --stream`** — the CLI outputs NDJSON events as the DAG executes
3. **Streams progress in real time** — parses NDJSON events (`node:enter`, `node:progress`, `node:exit`) and forwards them to Claude via MCP logging notifications
4. **Returns the final result** — the last JSON object from the stream, with success/failure status

The MCP server itself is stateless — each tool call is independent.

## Relationship to MCP server auto-injection

SWEny has two MCP integration points — don't confuse them:

| Concept | What it does | Docs |
|---------|-------------|------|
| **SWEny _as_ MCP server** (this page) | Exposes SWEny workflows as tools for Claude Code/Desktop |  |
| **[MCP server auto-injection](/advanced/mcp-servers/)** | SWEny injects external MCP servers (GitHub, Linear, etc.) into its own workflows | [MCP Servers](/advanced/mcp-servers/) |

They complement each other: Claude Code calls SWEny via MCP, and SWEny's workflows internally use other MCP servers to access external services.
