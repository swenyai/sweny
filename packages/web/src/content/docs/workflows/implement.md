---
title: Implement Workflow
description: The built-in workflow for implementing fixes from issues.
---

The implement workflow takes an issue, analyzes it, writes a fix, opens a pull request, and notifies the team. It uses Claude Code's full coding capabilities through the `github` skill to make real code changes.

## Overview

```
analyze --[low/medium risk + clear plan]--> implement --> create_pr --> notify
        \
         --[too complex or risky]--> skip
```

Five nodes, one conditional branch:

1. **analyze** -- read the issue, understand the codebase, and plan the fix
2. **implement** -- create a branch, make code changes, and commit
3. **create_pr** -- push the branch and open a pull request
4. **notify** -- send a summary with the PR link
5. **skip** -- add a comment to the issue explaining why automated implementation is not appropriate

## Workflow definition

This is the actual definition from `@sweny-ai/core`:

```typescript
import type { Workflow } from "../types.js";

export const implementWorkflow: Workflow = {
  id: "implement",
  name: "Implement Fix",
  description:
    "Implement a code fix for an issue and open a pull request",
  entry: "analyze",

  nodes: {
    analyze: {
      name: "Analyze Issue",
      instruction: `Read the issue details and understand what needs to be fixed:

1. Fetch the issue from the tracker (GitHub or Linear).
2. Read the relevant source files to understand the current code.
3. Identify the exact files and lines that need to change.
4. Plan the fix approach.

Output a clear analysis of what needs to change and why.`,
      skills: ["github", "linear"],
      output: {
        type: "object",
        properties: {
          issue_summary: { type: "string" },
          files_to_change: {
            type: "array",
            items: { type: "string" },
          },
          fix_plan: { type: "string" },
          risk_level: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
        },
        required: ["issue_summary", "fix_plan"],
      },
    },

    implement: {
      name: "Implement Fix",
      instruction: `Implement the planned fix:

1. Create a feature branch.
2. Make the necessary code changes.
3. Ensure changes are minimal and focused — fix the bug, nothing more.
4. Stage and commit with a clear commit message referencing the issue.

If the fix is too risky or complex, explain why and skip.`,
      skills: ["github"],
    },

    create_pr: {
      name: "Open Pull Request",
      instruction: `Open a pull request for the fix:

1. Push the branch to the remote.
2. Create a PR with a clear title and description.
3. Reference the original issue in the PR body.
4. Add appropriate reviewers or labels if possible.

Return the PR URL.`,
      skills: ["github"],
    },

    notify: {
      name: "Notify",
      instruction: `Send a notification about the implementation result:

1. Include: issue reference, PR link, brief summary of changes.
2. Keep it concise — one message, not a wall of text.`,
      skills: ["slack", "notification"],
    },

    skip: {
      name: "Skip — Too Complex",
      instruction: `The fix was determined to be too complex or risky for automated implementation.
Add a comment to the issue explaining what was found and why it needs manual attention.`,
      skills: ["github", "linear"],
    },
  },

  edges: [
    {
      from: "analyze",
      to: "implement",
      when: "Fix risk level is low or medium and a clear plan exists",
    },
    {
      from: "analyze",
      to: "skip",
      when: "Fix is too complex, risky, or unclear",
    },
    { from: "implement", to: "create_pr" },
    { from: "create_pr", to: "notify" },
  ],
};
```

## Node details

| Node | Name | Skills | Structured output? |
|------|------|--------|--------------------|
| `analyze` | Analyze Issue | `github`, `linear` | Yes |
| `implement` | Implement Fix | `github` | No |
| `create_pr` | Open Pull Request | `github` | No |
| `notify` | Notify | `slack`, `notification` | No |
| `skip` | Skip -- Too Complex | `github`, `linear` | No |

## The `analyze` output schema

The `analyze` node produces structured output that drives the conditional routing:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issue_summary` | string | Yes | What the issue is about |
| `files_to_change` | string[] | No | File paths that need modification |
| `fix_plan` | string | Yes | Step-by-step plan for the fix |
| `risk_level` | enum: `low`, `medium`, `high` | No | How risky the change is |

## Conditional routing

After `analyze` completes, Claude evaluates two conditions:

- **To `implement`**: "Fix risk level is low or medium and a clear plan exists"
- **To `skip`**: "Fix is too complex, risky, or unclear"

A `risk_level: "high"` result or an incomplete `fix_plan` routes to `skip`, where Claude adds a comment to the issue explaining what was found and why the fix needs manual attention. This prevents Claude from making risky changes without human oversight.

## How implementation works

The `implement` and `create_pr` nodes use the `github` skill, which gives Claude access to full coding capabilities through Claude Code. At these nodes, Claude can:

- Read and write files in the repository
- Create branches and make commits
- Push branches and open pull requests
- Add reviewers and labels

The instruction at each node keeps Claude focused on a specific task. The `implement` node explicitly says "fix the bug, nothing more" to prevent scope creep. The `create_pr` node focuses on the PR itself -- title, description, issue reference.

## Running the implement workflow

**From the CLI:**

```bash
sweny implement ENG-123           # implement a fix for a Linear issue
sweny implement --dry-run ENG-123 # analyze without making changes
```

**From GitHub Actions:**

```yaml
- uses: swenyai/triage@v1
  with:
    workflow: implement
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    issue-tracker-provider: linear
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
```

**Export and customize:**

```bash
sweny workflow export implement > my-implement.yml
# Edit the YAML, then run:
sweny workflow run my-implement.yml
```

## Triage + Implement pipeline

The triage and implement workflows are designed to work together. A common pattern is to run triage on a schedule to create issues, then run implement on new issues:

```yaml
# Step 1: Triage runs on a schedule, creates issues
name: SWEny Triage
on:
  schedule:
    - cron: '0 6 * * 1,4'

# Step 2: Implement runs when a triage issue is created
name: SWEny Implement
on:
  issues:
    types: [opened]
    labels: [agent, triage]
```

## What's next?

- [Custom Workflows](/workflows/custom/) -- build your own workflows or modify the built-ins
- [Triage Workflow](/workflows/triage/) -- the built-in alert investigation workflow
- [YAML Reference](/workflows/yaml-reference/) -- full schema for workflow files
