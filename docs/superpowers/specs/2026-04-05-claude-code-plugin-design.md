# SWEny Claude Code Plugin Design

**Date:** 2026-04-05
**Status:** Approved

## Goal

Create a Claude Code plugin that exposes the full SWEny CLI surface area to both users (via slash commands) and Claude itself (via MCP tools). The plugin should make SWEny a first-class citizen inside Claude Code — users trigger workflows with `/sweny:triage`, Claude autonomously delegates complex tasks to SWEny's DAG executor, and credential issues surface early via hooks.

## Non-goals

- Replacing the existing `@sweny-ai/mcp` package (it becomes a component the plugin wires)
- Reimplementing CLI logic in the plugin (skills invoke the CLI via Bash)
- Extensive hook automation at launch (start with one hook, expand later)

## Package location

`packages/plugin/` — a new package in the monorepo, separate from `packages/mcp`. Not published to npm. Distributed via GitHub marketplace.

## Plugin manifest

```json
{
  "name": "sweny",
  "version": "0.1.0",
  "description": "SWEny AI workflows for Claude Code — triage production alerts, implement fixes, run e2e tests, and create custom workflows",
  "author": {
    "name": "SWEny AI",
    "url": "https://sweny.ai"
  },
  "homepage": "https://sweny.ai/docs/advanced/mcp-plugin",
  "repository": "https://github.com/swenyai/sweny",
  "license": "MIT",
  "keywords": ["sweny", "triage", "workflow", "e2e", "alerts", "mcp"]
}
```

## Directory structure

```
packages/plugin/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── triage/
│   │   └── SKILL.md
│   ├── implement/
│   │   └── SKILL.md
│   ├── e2e-init/
│   │   └── SKILL.md
│   ├── e2e-run/
│   │   └── SKILL.md
│   ├── workflow-create/
│   │   └── SKILL.md
│   ├── workflow-edit/
│   │   └── SKILL.md
│   ├── workflow-run/
│   │   └── SKILL.md
│   ├── workflow-diagram/
│   │   └── SKILL.md
│   ├── init/
│   │   └── SKILL.md
│   ├── check/
│   │   └── SKILL.md
│   └── setup/
│       └── SKILL.md
├── agents/
│   └── sweny-workflow.md
├── hooks/
│   └── hooks.json
├── .mcp.json
├── README.md
└── CHANGELOG.md
```

## Skills

### Triage (`/sweny:triage`)

```yaml
---
name: triage
description: Run SWEny triage to investigate production alerts, create issues, and optionally implement fixes. Use when the user wants to analyze recent errors or alerts.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: [--dry-run]
---
```

Runs `sweny triage --stream`. Pass `--dry-run` if the user asks to investigate without creating issues/PRs. This is a long-running command (2-10 min) so it runs in a forked context using the sweny-workflow agent.

### Implement (`/sweny:implement`)

```yaml
---
name: implement
description: Pick up an issue and implement a fix with SWEny. Use when the user has an issue ID or URL they want resolved.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: <issue-id-or-url>
---
```

Runs `sweny implement $ARGUMENTS --stream`. Requires an issue ID/URL as argument. Forked context.

### E2E Init (`/sweny:e2e-init`)

```yaml
---
name: e2e-init
description: Generate agent-driven browser E2E test workflows interactively. Creates test files in .sweny/e2e/.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: (interactive)
---
```

Runs `sweny e2e init`. Interactive wizard, stays in main context (needs user input for flow type selection, base URL, etc.).

### E2E Run (`/sweny:e2e-run`)

```yaml
---
name: e2e-run
description: Run SWEny E2E browser test workflows. Executes tests from .sweny/e2e/ directory.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: [file] [--timeout <ms>]
---
```

Runs `sweny e2e run $ARGUMENTS`. Optionally takes a specific file and timeout. Forked context — tests can run 15+ minutes.

### Workflow Create (`/sweny:workflow-create`)

```yaml
---
name: workflow-create
description: Generate a new SWEny workflow from a natural language description. Saves to .sweny/workflows/.
allowed-tools: Bash
argument-hint: <description>
---
```

Runs `sweny workflow create "$ARGUMENTS"`. Interactive refinement loop, stays in main context. Both user and Claude can invoke this.

### Workflow Edit (`/sweny:workflow-edit`)

```yaml
---
name: workflow-edit
description: Edit an existing SWEny workflow using natural language instructions.
allowed-tools: Bash
argument-hint: <file> [instruction]
---
```

Runs `sweny workflow edit $ARGUMENTS`. Interactive, main context.

### Workflow Run (`/sweny:workflow-run`)

```yaml
---
name: workflow-run
description: Run a SWEny workflow from a YAML file. For custom workflows in .sweny/workflows/.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: <file> [--dry-run] [--input <json>]
---
```

Runs `sweny workflow run $ARGUMENTS --stream`. Forked context.

### Workflow Diagram (`/sweny:workflow-diagram`)

```yaml
---
name: workflow-diagram
description: Render a SWEny workflow as a Mermaid diagram. Useful for visualizing workflow structure.
allowed-tools: Bash
argument-hint: <file> [--direction TB|LR]
---
```

Runs `sweny workflow diagram $ARGUMENTS`. Quick command, main context. Both user and Claude can invoke.

### Init (`/sweny:init`)

```yaml
---
name: init
description: Set up SWEny in the current project. Interactive wizard that creates .sweny.yml config and .env template.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: (interactive)
---
```

Runs `sweny init`. Interactive wizard, main context.

### Check (`/sweny:check`)

```yaml
---
name: check
description: Verify SWEny provider credentials and connectivity. Run this to diagnose configuration issues before running workflows.
allowed-tools: Bash
---
```

Runs `sweny check`. Quick command. Both user and Claude can invoke — Claude may use this proactively to verify setup before suggesting a workflow run.

### Setup (`/sweny:setup`)

```yaml
---
name: setup
description: Create standard SWEny label set in your issue tracker (Linear or GitHub). Run after init to prepare your tracker for triage.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: <linear|github>
---
```

Runs `sweny setup $ARGUMENTS`.

## Agent

### sweny-workflow

```yaml
---
name: sweny-workflow
description: Execute SWEny workflows in isolation. Use when delegating multi-step DAG execution that should not pollute the main conversation context.
model: sonnet
maxTurns: 5
---
```

Purpose: Skills with `context: fork` use this agent. It runs the CLI command, monitors output, and returns a concise summary. Low `maxTurns` because the agent just runs a command and reports — SWEny handles the actual multi-step execution internally.

System prompt instructs the agent to:
- Run the requested `sweny` CLI command via Bash
- Pass `--json` or `--stream` for structured output
- Report the final result concisely
- Not make code changes itself (SWEny's internal agent handles that)

## MCP tools

Wired via `.mcp.json`:

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

Provides 2 existing tools:
- `sweny_list_workflows` — list available workflows
- `sweny_run_workflow` — execute triage or implement programmatically

These are for Claude's autonomous use — when it decides to delegate without user prompting.

## Hooks

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "test -f .sweny.yml && sweny check 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

**SessionStart:** If `.sweny.yml` exists, run `sweny check` to surface credential issues early. Fails silently if no config or if `sweny` is not installed. `|| true` ensures it never blocks startup. Stderr is suppressed so transient failures don't clutter the session.

## Distribution

### GitHub marketplace

Add `marketplace.json` at repo root:

```json
{
  "name": "sweny-official",
  "owner": {
    "name": "SWEny AI",
    "email": "hello@sweny.ai"
  },
  "metadata": {
    "description": "Official SWEny AI plugins for Claude Code",
    "version": "1.0.0"
  },
  "plugins": [
    {
      "name": "sweny",
      "source": "./packages/plugin",
      "description": "SWEny AI workflows — triage alerts, implement fixes, run e2e tests, create custom workflows",
      "version": "0.1.0",
      "category": "productivity"
    }
  ]
}
```

Users install with:
```
/plugin install https://github.com/swenyai/sweny
```

### Official Anthropic marketplace

Submit via claude.ai/settings/plugins/submit after initial release and validation.

## Testing strategy

1. **Structure validation:** `claude plugin validate packages/plugin/` — verify manifest, skill files, hooks
2. **Skill smoke tests:** Each skill can be tested with `claude --plugin-dir packages/plugin/` and invoking the slash command
3. **Hook test:** Verify SessionStart hook runs `sweny check` when `.sweny.yml` exists and is silent when it doesn't
4. **MCP integration:** Existing `packages/mcp` tests cover tool functionality
5. **End-to-end:** Install plugin from marketplace URL, verify all skills appear in `/help`

## Implementation order

1. Create `packages/plugin/` directory structure
2. Write `plugin.json` manifest
3. Write all 11 SKILL.md files
4. Write agent definition
5. Write hooks.json
6. Write .mcp.json
7. Write README.md
8. Add marketplace.json at repo root
9. Test with `claude --plugin-dir`
10. Update docs site with plugin installation instructions
11. Submit to Anthropic marketplace
