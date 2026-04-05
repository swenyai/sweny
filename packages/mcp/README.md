# @sweny-ai/mcp

MCP server that exposes SWEny workflows to Claude Code and Claude Desktop.

## What it does

This package runs as a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, giving Claude two tools:

| Tool | Description |
|------|-------------|
| `sweny_list_workflows` | List built-in and custom workflows in the current project |
| `sweny_run_workflow` | Execute a triage or implement workflow and return structured results |

This lets Claude Code delegate complex multi-step tasks to SWEny's DAG executor, which manages context boundaries across nodes — something a single conversation context can't do well.

## Setup

### Claude Code

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "sweny": {
      "command": "npx",
      "args": ["-y", "sweny-mcp"]
    }
  }
}
```

Or if running from a local clone of this repo:

```json
{
  "mcpServers": {
    "sweny": {
      "command": "node",
      "args": ["./packages/mcp/dist/index.js"]
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
      "args": ["-y", "sweny-mcp"]
    }
  }
}
```

## Prerequisites

- A `.sweny.yml` config file in the working directory (run `sweny init` to create one)
- Credentials for your configured providers (set via environment variables or `.env`)
- `@sweny-ai/core` installed (provides the `sweny` CLI binary)

## Tools

### `sweny_list_workflows`

Lists available workflows. Returns built-in workflows (triage, implement, seed-content) and any custom workflows found in `.sweny/workflows/*.yml`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `cwd` | string | no | Working directory to search. Defaults to `process.cwd()`. |

### `sweny_run_workflow`

Executes a SWEny workflow by spawning the `sweny` CLI. Returns structured JSON results on completion.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `"triage"` \| `"implement"` | yes | Which workflow to run |
| `input` | string | for implement | Issue ID or URL (required for implement, ignored for triage) |
| `cwd` | string | no | Working directory containing `.sweny.yml` |
| `dryRun` | boolean | no | Skip side effects (no issues/PRs created) |

**Notes:**
- Triage discovers alerts automatically via your configured observability provider
- Implement requires an issue ID from your configured issue tracker
- Workflows can take several minutes to complete
- A 10-minute timeout kills hanging processes

## Development

```bash
npm run build      # Compile TypeScript + chmod +x
npm run typecheck  # Type-check without emitting
npm test           # Run all tests (20 tests across 3 suites)
```
