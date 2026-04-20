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
- A `.sweny.yml` config file in your project (run `/sweny:new` to create one)
- Provider credentials set via environment variables or `.env`

## Skills

| Skill | Description |
|-------|-------------|
| `/sweny:new` | Create a new workflow — interactive picker for templates, AI-generated workflows, and end-to-end browser tests |
| `/sweny:triage` | Investigate production alerts, create issues, implement fixes |
| `/sweny:implement` | Pick up an issue and implement a fix |
| `/sweny:e2e-run` | Run E2E browser test workflows from `.sweny/e2e/` |
| `/sweny:workflow-run` | Run a workflow from any YAML file |
| `/sweny:workflow-edit` | Edit an existing workflow with natural language |
| `/sweny:workflow-diagram` | Render a workflow as a Mermaid diagram |
| `/sweny:check` | Verify provider credentials and connectivity |
| `/sweny:setup` | Create the standard SWEny label set in your issue tracker |

## MCP Tools

The plugin also registers an MCP server that gives Claude two tools for autonomous use:

- `sweny_list_workflows` — list available workflows
- `sweny_run_workflow` — execute triage or implement programmatically

## Hooks

- **SessionStart** — runs `sweny check` on startup if `.sweny.yml` exists, surfacing credential issues early

## Agent

- **sweny-workflow** — isolated execution agent for long-running workflows (used by triage, implement, e2e-run, workflow-run skills)
