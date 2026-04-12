# SWEny Plugin for Claude Code

Claude Code plugin that exposes SWEny AI workflows as skills, MCP tools, hooks, and agents.

## Install

```
/plugin marketplace add swenyai/sweny
/plugin install sweny@sweny-official
```

Or for local development:

```bash
claude --plugin-dir packages/plugin
```

## Prerequisites

- [SWEny CLI](https://www.npmjs.com/package/@sweny-ai/core) installed (`npm install -g @sweny-ai/core` or available via npx)
- A `.sweny.yml` config file in your project (run `/sweny:init` to create one)
- Provider credentials set via environment variables or `.env`

## Skills

| Skill | Description |
|-------|-------------|
| `/sweny:triage` | Investigate production alerts, create issues, implement fixes |
| `/sweny:implement` | Pick up an issue and implement a fix |
| `/sweny:e2e-init` | Generate browser E2E test workflows |
| `/sweny:e2e-run` | Run E2E test workflows |
| `/sweny:workflow-create` | Generate a workflow from natural language |
| `/sweny:workflow-edit` | Edit a workflow with natural language |
| `/sweny:workflow-run` | Run any workflow from a YAML file |
| `/sweny:workflow-diagram` | Visualize a workflow as a Mermaid diagram |
| `/sweny:init` | Set up SWEny in the current project |
| `/sweny:check` | Verify provider credentials |
| `/sweny:setup` | Create labels in your issue tracker |

## MCP Tools

The plugin also registers an MCP server that gives Claude two tools for autonomous use:

- `sweny_list_workflows` — list available workflows
- `sweny_run_workflow` — execute triage or implement programmatically

## Hooks

- **SessionStart** — runs `sweny check` on startup if `.sweny.yml` exists, surfacing credential issues early

## Agent

- **sweny-workflow** — isolated execution agent for long-running workflows (used by triage, implement, e2e-run, workflow-run skills)
