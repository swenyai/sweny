---
title: SWEny Implement
description: Implement fixes for known issues without log scanning — jump straight from ticket to PR.
---

**SWEny Implement** is the second built-in workflow. When you already have an issue and want a fix PR fast, Implement skips log scanning entirely and goes straight to reading the code, writing a fix, and opening a PR.

## How it works

### Learn

- Fetches the issue from your tracker by identifier (e.g. `ENG-123`, `#42`)
- Reads the full issue title, description, and any linked context

### Act

- Investigates the codebase using Claude AI — traces the issue to root cause
- Implements a fix on a new branch
- Opens a PR linked back to the originating issue

### Report

- Posts a summary to your configured notification channel
- Includes a link to the PR and a summary of the changes made

## When to use Implement vs Triage

| | Implement | Triage |
|---|---|---|
| You have a known issue | ✓ | — |
| You want to scan for new issues | — | ✓ |
| No observability credentials needed | ✓ | — |
| Scheduled / automated | — | ✓ |
| On-demand / manual | ✓ | ✓ |

Use **Implement** when the issue already exists in your tracker and you want a PR quickly. Use **Triage** for scheduled, autonomous monitoring that discovers and fixes issues automatically.

## Configuration

Implement requires an issue tracker and source control provider. No observability provider is needed.

- [Action Inputs](/action/inputs/) — `workflow: implement`, `linear-issue`, provider credentials
- [CLI Inputs](/cli/inputs/) — `sweny implement` flags and positional argument
- [Examples](/action/examples/) — GitHub Action and CLI usage patterns

## GitHub Action

```yaml
name: Implement Fix

on:
  workflow_dispatch:
    inputs:
      issue:
        description: Issue identifier (e.g. ENG-123)
        required: true

jobs:
  implement:
    runs-on: ubuntu-latest
    steps:
      - uses: swenyai/sweny@v3
        with:
          workflow: implement
          linear-issue: ${{ github.event.inputs.issue }}
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          linear-api-key: ${{ secrets.LINEAR_API_KEY }}
          linear-team-id: ${{ secrets.LINEAR_TEAM_ID }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

This workflow can be triggered manually from the GitHub Actions UI — paste in any issue identifier and SWEny opens a PR within minutes.

## CLI

```bash
sweny implement ENG-123
```

Pass extra instructions to guide the agent:

```bash
sweny implement ENG-123 \
  --additional-instructions 'Prefer adding a null guard over restructuring the function'
```

Set the target branch if your default is not `main`:

```bash
sweny implement ENG-123 --base-branch develop
```

## Get started

Follow the [Quick Start](/getting-started/) to configure your providers, or see [CLI Examples](/cli/examples/) for more `sweny implement` recipes.
