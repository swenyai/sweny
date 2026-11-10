# @sweny-ai/mcp

MCP server that exposes SWEny workflows to Claude Code and Claude Desktop.

## What it does

This package runs as a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, giving Claude six tools:

| Tool | Description |
|------|-------------|
| `sweny_list_workflows` | List built-in and custom workflows in the current project |
| `sweny_run_workflow` | Execute a triage or implement workflow and return structured results |
| `sweny_validate` | Check a workflow file (schema and structure) without running it |
| `sweny_diagram` | Render a workflow as a Mermaid diagram |
| `sweny_runs` | List recorded runs from `.sweny/runs/` |
| `sweny_runs_diff` | Compare two recorded runs: answers, status, spend |

This lets Claude Code delegate complex multi-step tasks to SWEny's DAG executor, which manages context boundaries across nodes — something a single conversation context can't do well.

## Setup

### Claude Code

Add to your project's `.claude/settings.json`:

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

## Prerequisites

- A `.sweny.yml` config file in the working directory (run `sweny new` to create one)
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

### Read-only inspection tools

`sweny_validate`, `sweny_diagram`, `sweny_runs` and `sweny_runs_diff` call `@sweny-ai/core` directly (no CLI process) and never write. Each returns a short text summary, then the structured result as JSON.

Paths are confined to the directory the server was started in: `..` traversal, absolute paths outside it, and symlinks that leave it are refused. Only `.yml`, `.yaml` and `.json` files are read. Run history is treated as untrusted (an agent can write to `.sweny/runs/`): forged, linked or oversized records are skipped, a `.sweny/runs` that links out of the project is refused, and text read from history or workflow files has terminal control sequences stripped.

| Tool | Parameters | JSON result |
|------|------------|-------------|
| `sweny_validate` | `file` (workflow path) | `{ valid, errors: [{ code, message, nodeId }], warnings?, workflow: { id, name, nodes, edges } }`. An invalid workflow is a normal result with `valid: false`. |
| `sweny_diagram` | `file` (built-in name or path), `direction` (`TB` \| `LR`), `title`, `block` | `{ workflow: { id, name }, direction, nodes, edges, mermaid }` |
| `sweny_runs` | `workflow`, `limit` (1-200, default 20) | `{ schema_version: 1, runs: [...] }`, newest first |
| `sweny_runs_diff` | `a`, `b` (run id or prefix; both or neither), `workflow` | `{ schema_version: 1, a, b, answers }`, the `sweny runs diff --json` schema |

Example:

```json
{ "name": "sweny_validate", "arguments": { "file": ".sweny/workflows/demo.yml" } }
```

```
.sweny/workflows/demo.yml has 1 validation error:
- UNKNOWN_EDGE_TARGET: Edge target "ghost" does not exist
```

```json
{
  "valid": false,
  "errors": [{ "code": "UNKNOWN_EDGE_TARGET", "message": "Edge target \"ghost\" does not exist", "nodeId": "ghost" }]
}
```

## Development

```bash
npm run build      # Compile TypeScript + chmod +x
npm run typecheck  # Type-check without emitting
npm test           # Run all tests
```
