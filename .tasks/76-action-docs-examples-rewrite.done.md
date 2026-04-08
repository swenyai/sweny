# Task 76: Rewrite action/examples.md for multi-repo architecture

## Problem

`packages/web/src/content/docs/action/examples.md` has 11 complete workflow examples. ALL of them use `swenyai/sweny@v5` with triage-specific inputs that don't exist on the generic action. Every triage example should use `swenyai/triage@v1` instead.

## What to change

For each example, change `swenyai/sweny@v5` to the correct action:

| Example | Correct action | Why |
|---------|---------------|-----|
| Minimal triage (Sentry) | `swenyai/triage@v1` | Uses observability-provider, sentry-* |
| Full stack (DD + Linear + Slack) | `swenyai/triage@v1` | Uses dd-*, linear-*, notification-* |
| Implement from Linear issue | `swenyai/triage@v1` | Uses workflow: implement, linear-* |
| Multi-provider (Sentry + DD) | `swenyai/triage@v1` | Uses observability-provider, sentry-*, mcp-servers |
| Custom MCP servers | `swenyai/triage@v1` | Uses dd-*, mcp-servers |
| Workspace tools (Slack + Notion) | `swenyai/triage@v1` | Uses dd-*, workspace-tools |
| Dry run | `swenyai/triage@v1` | Uses dd-*, dry-run, time-range |
| Vercel + GitHub Issues | `swenyai/triage@v1` | Uses observability-provider, vercel-* |
| GitLab + Jira | `swenyai/triage@v1` | Uses dd-*, source-control-provider, gitlab-*, jira-* |
| Auto-merge | `swenyai/triage@v1` | Uses dd-*, review-mode, pr-labels |
| Chaining triage + implement | `swenyai/triage@v1` | Uses dd-*, workflow: implement |

Also **add a new example** at the top showing the generic `swenyai/sweny@v5` action running a custom workflow YAML:

```yaml
name: Weekly Competitive Scan
on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/competitive-scan.yml
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

## File

`packages/web/src/content/docs/action/examples.md`

## Validation

After editing, every `swenyai/sweny@v5` should only appear with `workflow:` input. Every `swenyai/triage@v1` should have triage-specific inputs. No code block should mix the two.
