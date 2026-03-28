---
title: Linear
description: Create, search, and update issues in Linear.
---

The Linear skill connects Claude to your Linear workspace for issue tracking. Claude can search existing issues, create new ones with structured metadata, and update issue state and priority.

## Metadata

| Field | Value |
|-------|-------|
| **ID** | `linear` |
| **Category** | `tasks` |
| **Required env vars** | `LINEAR_API_KEY` |

## Tools

| Tool | Description |
|------|-------------|
| `linear_create_issue` | Create a new Linear issue with title, description, priority, and labels |
| `linear_search_issues` | Search issues by text query, returning ID, title, state, priority, and URL |
| `linear_get_issue` | Fetch a single issue by ID or identifier (e.g., `ENG-123`) |
| `linear_update_issue` | Update an existing issue's title, description, state, or priority |
| `linear_add_comment` | Add a comment to an existing issue |
| `linear_list_teams` | List all teams in the workspace (useful for discovering team IDs) |

## Setup

1. Open **Linear > Settings > API** (or go to `linear.app/settings/api`).
2. Create a personal API key.
3. Set the environment variable:

```bash
export LINEAR_API_KEY="lin_api_..."
```

The key needs access to the teams and projects SWEny will interact with. Organization-wide keys work, but you can also scope to specific teams if your Linear plan supports it.

:::note[Team ID]
The `linear_create_issue` tool requires a `teamId` parameter — it will not auto-discover your team. Provide it explicitly:

- **GitHub Action:** set the `linear-team-id` input
- **CLI:** set `--linear-team-id <id>` or `linear-team-id` in `.sweny.yml`

You can find your team ID in **Linear > Settings > Team > General**. Claude also has access to `linear_list_teams`, which it may call to look up the correct ID if you provide a team name in your additional instructions.
:::

## Workflow usage

**Triage workflow:**
- **gather** — Search for similar past issues to avoid duplicates
- **create_issue** — File a new issue when the investigation finds a novel problem

**Implement workflow:**
- **analyze** — Fetch the target issue to understand what needs to be fixed
- **skip** — Comment on the issue if the fix is too complex for automated implementation
