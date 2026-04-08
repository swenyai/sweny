# Task 78: Rewrite action/inputs.md for multi-repo architecture

## Problem

`packages/web/src/content/docs/action/inputs.md` documents ALL inputs as if they're on one monolithic action. But the inputs are now split across three actions:

- `swenyai/sweny@v5` — only has: workflow, claude-oauth-token, anthropic-api-key, cli-version, node-version, working-directory
- `swenyai/triage@v1` — has ALL the observability, issue-tracker, notification, investigation, behavior, workspace, MCP inputs
- `swenyai/e2e@v1` — has: workflow, auth, base-url, agent-browser-version, screenshots-path, artifact-name, artifact-retention-days

## What to change

### Add a header explaining the three actions

Before the input tables, add a note like:

> SWEny ships three GitHub Actions. Each has its own inputs. Use the action that matches your use case.
>
> | Action | Use case | Repo |
> |--------|----------|------|
> | `swenyai/triage@v1` | SRE triage — monitors alerts, files tickets, opens fix PRs | [swenyai/triage](https://github.com/swenyai/triage) |
> | `swenyai/e2e@v1` | Agentic E2E tests — drives a real browser, uploads screenshots | [swenyai/e2e](https://github.com/swenyai/e2e) |
> | `swenyai/sweny@v5` | Generic runner — execute any SWEny workflow YAML | this repo |

### Restructure the sections

Organize inputs by which action they belong to:

1. **Generic runner inputs** (`swenyai/sweny@v5`): workflow, claude-oauth-token, anthropic-api-key, cli-version, node-version, working-directory
2. **Triage inputs** (`swenyai/triage@v1`): everything else that exists now — auth, coding agent, observability, issue tracking, source control, notification, investigation, PR settings, behavior, service map, workspace tools, MCP servers
3. **E2E inputs** (`swenyai/e2e@v1`): workflow, auth, base-url, agent-browser-version, node-version, working-directory, screenshots-path, artifact-name, artifact-retention-days

### Fix the Outputs section (lines 313-350)

The outputs code block at the bottom uses `swenyai/sweny@v5` with `dd-api-key` and `dd-app-key`. Change to `swenyai/triage@v1`.

### Fix the frontmatter description

Update to mention all three actions, not just "the SWEny GitHub Action".

## File

`packages/web/src/content/docs/action/inputs.md`

## Validation

- The generic runner section should list only 6 inputs
- The triage section should contain all observability/tracking/notification inputs
- The E2E section should list the browser test inputs
- No code block should use `swenyai/sweny@v5` with triage-specific inputs
