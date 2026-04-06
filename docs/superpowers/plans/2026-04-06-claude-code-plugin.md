# SWEny Claude Code Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Claude Code plugin at `packages/plugin/` that exposes the full SWEny CLI as skills, MCP tools, hooks, and an agent — installable via `/plugin install`.

**Architecture:** The plugin is a directory of markdown/JSON config files (no compiled code). Skills invoke the `sweny` CLI via the Bash tool. The existing `@sweny-ai/mcp` server is wired via `.mcp.json` for Claude's autonomous use. One SessionStart hook surfaces credential issues early.

**Tech Stack:** Claude Code plugin system (plugin.json manifest, SKILL.md files, hooks.json, .mcp.json), SWEny CLI (`@sweny-ai/core`)

**Spec:** `docs/superpowers/specs/2026-04-05-claude-code-plugin-design.md`

---

### Task 1: Scaffold plugin directory and manifest

**Files:**
- Create: `packages/plugin/.claude-plugin/plugin.json`

- [ ] **Step 1: Create the plugin manifest**

```bash
mkdir -p packages/plugin/.claude-plugin
```

Write `packages/plugin/.claude-plugin/plugin.json`:

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

- [ ] **Step 2: Create the skills directory structure**

```bash
mkdir -p packages/plugin/skills/{triage,implement,e2e-init,e2e-run,workflow-create,workflow-edit,workflow-run,workflow-diagram,init,check,setup}
mkdir -p packages/plugin/agents
mkdir -p packages/plugin/hooks
```

- [ ] **Step 3: Commit scaffold**

```bash
git add packages/plugin/.claude-plugin/plugin.json
git commit -m "feat(plugin): scaffold Claude Code plugin directory structure"
```

---

### Task 2: Core workflow skills — triage and implement

**Files:**
- Create: `packages/plugin/skills/triage/SKILL.md`
- Create: `packages/plugin/skills/implement/SKILL.md`

- [ ] **Step 1: Write triage skill**

Write `packages/plugin/skills/triage/SKILL.md`:

```markdown
---
name: triage
description: Run SWEny triage to investigate production alerts, create issues, and optionally implement fixes. Use when the user wants to analyze recent errors or alerts.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: [--dry-run]
---

# SWEny Triage

Run the SWEny triage workflow. This investigates production alerts from configured observability providers (Datadog, Sentry, BetterStack, etc.), performs root cause analysis, creates issues, and optionally implements fixes.

**Prerequisites:** A `.sweny.yml` config file and provider credentials must be set up. Run `/sweny:check` first if unsure.

## Usage

Run triage with default settings:

```bash
sweny triage --stream
```

Run in dry-run mode (investigate only, skip creating issues/PRs):

```bash
sweny triage --stream --dry-run
```

If the user provided arguments, pass them through:

```bash
sweny triage --stream $ARGUMENTS
```

## What to expect

- The workflow takes 2-10 minutes depending on alert volume
- Progress events stream as NDJSON (node:enter, node:progress, node:exit)
- On completion, report a concise summary: how many alerts found, issues created, PRs opened
- If it fails, check `sweny check` output for credential issues

## Common flags

- `--dry-run` — investigate without creating issues or PRs
- `--time-range <range>` — time window to analyze (default: 24h)
- `--severity-focus <focus>` — severity level (default: errors)
- `--service-filter <filter>` — filter by service pattern
```

- [ ] **Step 2: Write implement skill**

Write `packages/plugin/skills/implement/SKILL.md`:

```markdown
---
name: implement
description: Pick up an issue and implement a fix with SWEny. Use when the user has an issue ID or URL they want resolved.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: <issue-id-or-url>
---

# SWEny Implement

Run the SWEny implement workflow. This fetches an issue from the configured tracker (GitHub Issues, Linear, Jira), analyzes the codebase, implements a fix, and opens a pull request.

**Requires:** An issue ID or URL as the first argument.

## Usage

```bash
sweny implement $ARGUMENTS --stream
```

If the user did not provide an issue ID, ask them for one before running. Do not run without an issue ID — the CLI will fail.

For dry-run mode (analyze and plan without creating a PR):

```bash
sweny implement $ARGUMENTS --stream --dry-run
```

## What to expect

- The workflow takes 3-10 minutes depending on complexity
- SWEny creates a branch, makes changes, commits, and opens a PR
- On completion, report: branch name, PR URL, and a brief summary of changes
- If it reports "Too Complex", the issue needs human intervention

## Common flags

- `--dry-run` — analyze and plan without creating a branch or PR
- `--base-branch <branch>` — base branch for the PR (default: main)
- `--max-implement-turns <n>` — max coding agent turns (default: 40)
```

- [ ] **Step 3: Commit core workflow skills**

```bash
git add packages/plugin/skills/triage/SKILL.md packages/plugin/skills/implement/SKILL.md
git commit -m "feat(plugin): add triage and implement skills"
```

---

### Task 3: E2E testing skills

**Files:**
- Create: `packages/plugin/skills/e2e-init/SKILL.md`
- Create: `packages/plugin/skills/e2e-run/SKILL.md`

- [ ] **Step 1: Write e2e-init skill**

`sweny e2e init` is an interactive wizard using @clack/prompts. It cannot run headlessly through the Bash tool. The skill instructs the user to run it themselves.

Write `packages/plugin/skills/e2e-init/SKILL.md`:

```markdown
---
name: e2e-init
description: Generate agent-driven browser E2E test workflows interactively. Creates test files in .sweny/e2e/.
disable-model-invocation: true
---

# SWEny E2E Init

This command runs an interactive wizard that generates browser-based end-to-end test workflows.

**This is an interactive terminal command.** It uses prompts that require direct user input, so it cannot be run via the Bash tool. Ask the user to run it directly:

> Run `! sweny e2e init` in this session to start the E2E test wizard.

The wizard will prompt for:
1. **Test flow types** — registration, login, purchase, onboarding, upgrade, cancellation, or custom
2. **Base URL** — the application URL to test against
3. **Cleanup backend** — optional (Supabase, Firebase, or Postgres) for cleaning up test data

Generated workflow files are saved to `.sweny/e2e/`. After generation, use `/sweny:e2e-run` to execute them.
```

- [ ] **Step 2: Write e2e-run skill**

Write `packages/plugin/skills/e2e-run/SKILL.md`:

```markdown
---
name: e2e-run
description: Run SWEny E2E browser test workflows from .sweny/e2e/. Use when the user wants to execute end-to-end tests.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: [file] [--timeout <ms>]
---

# SWEny E2E Run

Run agent-driven browser end-to-end tests. Executes workflow files from `.sweny/e2e/`.

**Prerequisites:** E2E workflows must exist in `.sweny/e2e/`. Run `/sweny:e2e-init` first if the directory is empty.

## Usage

Run all E2E tests:

```bash
sweny e2e run
```

Run a specific test file:

```bash
sweny e2e run $ARGUMENTS
```

With a custom timeout (default is 15 minutes per workflow):

```bash
sweny e2e run --timeout 300000
```

## What to expect

- Each test workflow takes 1-15 minutes depending on flow complexity
- Tests use agent-browser for accessibility-tree-based browser automation (not screenshots)
- On completion, report: pass/fail status for each flow, any errors encountered
- Test data matching `e2e-{run_id}` patterns is automatically cleaned up if a cleanup backend is configured

## Environment variables

- `E2E_BASE_URL` — override the base URL for tests
- `E2E_EMAIL` — override test email (default: e2e-{run_id}@yourapp.test)
- `E2E_PASSWORD` — override test password
```

- [ ] **Step 3: Commit e2e skills**

```bash
git add packages/plugin/skills/e2e-init/SKILL.md packages/plugin/skills/e2e-run/SKILL.md
git commit -m "feat(plugin): add e2e-init and e2e-run skills"
```

---

### Task 4: Workflow management skills

**Files:**
- Create: `packages/plugin/skills/workflow-create/SKILL.md`
- Create: `packages/plugin/skills/workflow-edit/SKILL.md`
- Create: `packages/plugin/skills/workflow-run/SKILL.md`
- Create: `packages/plugin/skills/workflow-diagram/SKILL.md`

- [ ] **Step 1: Write workflow-create skill**

Write `packages/plugin/skills/workflow-create/SKILL.md`:

```markdown
---
name: workflow-create
description: Generate a new SWEny workflow from a natural language description. Saves to .sweny/workflows/.
allowed-tools: Bash
argument-hint: <description>
---

# SWEny Workflow Create

Generate a new DAG workflow from a natural language description. The CLI uses Claude to design the workflow, then saves it as YAML.

## Usage

Use `--json` mode for non-interactive generation:

```bash
sweny workflow create "$ARGUMENTS" --json
```

This outputs the workflow JSON to stdout without interactive prompts. Save the result:

```bash
sweny workflow create "$ARGUMENTS" --json > .sweny/workflows/new-workflow.yml
```

If the user wants an interactive refinement loop with visualization, ask them to run it directly:

> Run `! sweny workflow create "your description"` for interactive workflow creation with a refinement loop.

## After creation

- The workflow is saved to `.sweny/workflows/{id}.yml`
- Use `/sweny:workflow-diagram` to visualize it
- Use `/sweny:workflow-run` to execute it
- Use `/sweny:workflow-edit` to refine it
```

- [ ] **Step 2: Write workflow-edit skill**

Write `packages/plugin/skills/workflow-edit/SKILL.md`:

```markdown
---
name: workflow-edit
description: Edit an existing SWEny workflow using natural language instructions.
allowed-tools: Bash
argument-hint: <file> [instruction]
---

# SWEny Workflow Edit

Edit an existing workflow file using natural language instructions. The CLI applies the changes using Claude.

## Usage

Use `--json` mode for non-interactive editing:

```bash
sweny workflow edit $ARGUMENTS --json
```

This outputs the updated workflow JSON to stdout. To update the file in place, pipe the output back:

```bash
sweny workflow edit .sweny/workflows/my-workflow.yml "add a notification step at the end" --json > /tmp/updated.yml && mv /tmp/updated.yml .sweny/workflows/my-workflow.yml
```

If the user wants an interactive refinement loop, ask them to run it directly:

> Run `! sweny workflow edit <file> "your instruction"` for interactive editing with a refinement loop.
```

- [ ] **Step 3: Write workflow-run skill**

Write `packages/plugin/skills/workflow-run/SKILL.md`:

```markdown
---
name: workflow-run
description: Run a SWEny workflow from a YAML file. For custom or built-in workflows.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: <file> [--dry-run] [--input <json>]
---

# SWEny Workflow Run

Run any SWEny workflow from a YAML or JSON file. Works with custom workflows in `.sweny/workflows/` and built-in workflow exports.

## Usage

Run a workflow file:

```bash
sweny workflow run $ARGUMENTS --stream
```

With JSON input data:

```bash
sweny workflow run .sweny/workflows/my-workflow.yml --stream --input '{"key": "value"}'
```

Dry-run (validate without executing):

```bash
sweny workflow run .sweny/workflows/my-workflow.yml --dry-run
```

## What to expect

- Execution time depends on the workflow's node count and complexity
- Progress events stream as NDJSON
- On completion, report the structured result from the final JSON output
- If `--mermaid` is passed, a Mermaid diagram with execution state is appended to output
```

- [ ] **Step 4: Write workflow-diagram skill**

Write `packages/plugin/skills/workflow-diagram/SKILL.md`:

```markdown
---
name: workflow-diagram
description: Render a SWEny workflow as a Mermaid diagram for visualization.
allowed-tools: Bash
argument-hint: <file> [--direction TB|LR]
---

# SWEny Workflow Diagram

Render a workflow file as a Mermaid diagram. Useful for visualizing workflow structure, node connections, and conditional edges.

## Usage

```bash
sweny workflow diagram $ARGUMENTS
```

The output is a Mermaid diagram wrapped in a code fence. Present it directly to the user — Claude Code renders Mermaid natively.

## Options

- `--direction TB` — top-to-bottom layout (default)
- `--direction LR` — left-to-right layout
- `--title <title>` — custom diagram title
- `--no-block` — output raw Mermaid without code fence
```

- [ ] **Step 5: Commit workflow management skills**

```bash
git add packages/plugin/skills/workflow-create/SKILL.md packages/plugin/skills/workflow-edit/SKILL.md packages/plugin/skills/workflow-run/SKILL.md packages/plugin/skills/workflow-diagram/SKILL.md
git commit -m "feat(plugin): add workflow management skills (create, edit, run, diagram)"
```

---

### Task 5: Setup and configuration skills

**Files:**
- Create: `packages/plugin/skills/init/SKILL.md`
- Create: `packages/plugin/skills/check/SKILL.md`
- Create: `packages/plugin/skills/setup/SKILL.md`

- [ ] **Step 1: Write init skill**

`sweny init` is an interactive wizard using @clack/prompts. Same pattern as e2e-init.

Write `packages/plugin/skills/init/SKILL.md`:

```markdown
---
name: init
description: Set up SWEny in the current project. Interactive wizard that creates .sweny.yml config and .env template.
disable-model-invocation: true
---

# SWEny Init

Initialize SWEny in the current project. This runs an interactive setup wizard that detects your git remote and walks you through configuring:

1. **Source control** — GitHub or GitLab
2. **Observability** — Datadog, Sentry, BetterStack, New Relic, CloudWatch, or None
3. **Issue tracker** — GitHub Issues, Linear, or Jira
4. **Notifications** — Console, Slack, Discord, Teams, or Webhook
5. **GitHub Action** — optional scheduled triage workflow

**This is an interactive terminal command.** Ask the user to run it directly:

> Run `! sweny init` in this session to start the setup wizard.

The wizard creates:
- `.sweny.yml` — provider configuration
- `.env` — credential placeholders with helpful comments
- `.github/workflows/sweny.yml` — optional CI/CD integration

After init, run `/sweny:check` to verify credentials are working.
```

- [ ] **Step 2: Write check skill**

Write `packages/plugin/skills/check/SKILL.md`:

```markdown
---
name: check
description: Verify SWEny provider credentials and connectivity. Run to diagnose configuration issues before running workflows.
allowed-tools: Bash
---

# SWEny Check

Verify that all configured provider credentials are valid and connectivity works. Tests each provider (Anthropic, Datadog, Sentry, Linear, GitHub, etc.) and reports status.

## Usage

```bash
sweny check
```

## Output

Each provider shows one of:
- **ok** — credentials valid, connection successful
- **fail** — credentials invalid or connection failed (details shown)
- **skip** — provider not configured

If any provider shows **fail**, the user needs to update their `.env` or environment variables before running workflows.

This is a quick command (a few seconds). Run it before `/sweny:triage` or `/sweny:implement` if you suspect configuration issues.
```

- [ ] **Step 3: Write setup skill**

Write `packages/plugin/skills/setup/SKILL.md`:

```markdown
---
name: setup
description: Create standard SWEny label set in your issue tracker (Linear or GitHub). Run after init to prepare your tracker for triage.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: <linear|github>
---

# SWEny Setup

Create the standard SWEny label set in your issue tracker. This creates labels that SWEny uses to categorize and track issues it creates during triage.

## Usage

For Linear:

```bash
sweny setup linear
```

For GitHub:

```bash
sweny setup github
```

If the user provided an argument, use it:

```bash
sweny setup $ARGUMENTS
```

If no argument was provided, check `.sweny.yml` to determine the issue tracker and suggest the right command.

## Labels created

- **Signal labels:** agent-needs-input, agent-error, human-only, needs-review
- **Work-type labels:** triage, feature, optimization, research, support, spec, task, bug
- **Parent group:** agent (with work-type children)

The command outputs resolved label IDs that can be pasted into `.sweny.yml` for configuration.
```

- [ ] **Step 4: Commit setup skills**

```bash
git add packages/plugin/skills/init/SKILL.md packages/plugin/skills/check/SKILL.md packages/plugin/skills/setup/SKILL.md
git commit -m "feat(plugin): add init, check, and setup skills"
```

---

### Task 6: Agent definition

**Files:**
- Create: `packages/plugin/agents/sweny-workflow.md`

- [ ] **Step 1: Write the sweny-workflow agent**

Write `packages/plugin/agents/sweny-workflow.md`:

```markdown
---
name: sweny-workflow
description: Execute SWEny workflows in isolation. Use when delegating long-running DAG execution that should not pollute the main conversation context.
model: sonnet
maxTurns: 5
---

You are a SWEny workflow executor. Your job is to run SWEny CLI commands and report results concisely.

## How to operate

1. Run the requested `sweny` CLI command using the Bash tool
2. Pass `--stream` when running workflows for real-time progress output
3. Monitor the output for errors or completion
4. Report the final result back concisely — summarize what happened, don't dump raw output

## Important

- Do NOT make code changes yourself — SWEny's internal coding agent handles implementation
- Do NOT modify files, create branches, or open PRs — the workflow does that
- Your role is strictly to invoke the CLI and summarize results
- If the command fails, report the error clearly and suggest next steps (usually `/sweny:check` for credential issues)
```

- [ ] **Step 2: Commit agent**

```bash
git add packages/plugin/agents/sweny-workflow.md
git commit -m "feat(plugin): add sweny-workflow agent for isolated execution"
```

---

### Task 7: Hooks and MCP configuration

**Files:**
- Create: `packages/plugin/hooks/hooks.json`
- Create: `packages/plugin/.mcp.json`

- [ ] **Step 1: Write hooks.json**

Write `packages/plugin/hooks/hooks.json`:

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

- [ ] **Step 2: Write .mcp.json**

Write `packages/plugin/.mcp.json`:

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

- [ ] **Step 3: Commit hooks and MCP config**

```bash
git add packages/plugin/hooks/hooks.json packages/plugin/.mcp.json
git commit -m "feat(plugin): add SessionStart hook and MCP server config"
```

---

### Task 8: README and CHANGELOG

**Files:**
- Create: `packages/plugin/README.md`
- Create: `packages/plugin/CHANGELOG.md`

- [ ] **Step 1: Write README.md**

Write `packages/plugin/README.md`:

```markdown
# SWEny Plugin for Claude Code

Claude Code plugin that exposes SWEny AI workflows as skills, MCP tools, hooks, and agents.

## Install

```
/plugin install https://github.com/swenyai/sweny
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
```

- [ ] **Step 2: Write CHANGELOG.md**

Write `packages/plugin/CHANGELOG.md`:

```markdown
# Changelog

## 0.1.0

Initial release.

- 11 skills covering the full SWEny CLI surface area
- MCP server integration for autonomous workflow execution
- SessionStart hook for credential verification
- sweny-workflow agent for isolated execution
```

- [ ] **Step 3: Commit README and CHANGELOG**

```bash
git add packages/plugin/README.md packages/plugin/CHANGELOG.md
git commit -m "docs(plugin): add README and CHANGELOG"
```

---

### Task 9: Marketplace configuration

**Files:**
- Create: `.claude-plugin/marketplace.json` (repo root)

- [ ] **Step 1: Write marketplace.json**

```bash
mkdir -p .claude-plugin
```

Write `.claude-plugin/marketplace.json`:

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

- [ ] **Step 2: Commit marketplace config**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat: add Claude Code plugin marketplace config"
```

---

### Task 10: Documentation updates

**Files:**
- Modify: `packages/web/src/content/docs/advanced/mcp-plugin.md`
- Modify: `README.md` (repo root)

- [ ] **Step 1: Update the MCP plugin docs page**

Add a new section at the top of `packages/web/src/content/docs/advanced/mcp-plugin.md` (after the frontmatter, before the existing content) explaining the plugin as the recommended installation method:

```markdown
## Quick start — Claude Code Plugin

The easiest way to use SWEny from Claude Code is to install the plugin:

```
/plugin install https://github.com/swenyai/sweny
```

This gives you slash commands (`/sweny:triage`, `/sweny:implement`, etc.), MCP tools for autonomous use, and a startup hook that verifies your credentials.

### Manual MCP setup

If you prefer to configure just the MCP server without the full plugin:
```

Then keep the existing "Setup" section as the manual alternative under the "Manual MCP setup" subheading.

- [ ] **Step 2: Update repo README**

Add a row to the "How you use it" section of the root `README.md` mentioning the Claude Code plugin:

```markdown
| Claude Code plugin | `/plugin install https://github.com/swenyai/sweny` — slash commands, MCP tools, hooks |
```

And add to the Packages table:

```markdown
| `packages/plugin` | Claude Code plugin | Slash commands, MCP tools, agent, hooks |
```

- [ ] **Step 3: Commit docs updates**

```bash
git add packages/web/src/content/docs/advanced/mcp-plugin.md README.md
git commit -m "docs: add Claude Code plugin installation to docs and README"
```

---

### Task 11: Validate and test

- [ ] **Step 1: Validate plugin structure**

```bash
claude plugin validate packages/plugin
```

Expected: validation passes with no errors.

- [ ] **Step 2: Fix any validation errors**

If validation reports issues (missing fields, wrong paths, etc.), fix them and re-validate.

- [ ] **Step 3: Test with --plugin-dir**

```bash
claude --plugin-dir packages/plugin
```

Inside the Claude Code session:
- Run `/help` and verify all 11 `/sweny:*` skills are listed
- Run `/sweny:check` to verify it executes `sweny check`
- Run `/sweny:workflow-diagram .sweny/e2e/registration.yml` or any existing workflow to verify diagram output

- [ ] **Step 4: Commit any fixes from validation**

```bash
git add -A packages/plugin/
git commit -m "fix(plugin): address validation feedback"
```

- [ ] **Step 5: Push all changes**

```bash
git push
```
