---
title: Skills Overview
description: How skills wire tools into workflow nodes.
---

Skills are the connectors between your workflows and external services. Each skill is a logical group of tools that share configuration — set the required environment variables and the skill is ready. No boilerplate, no adapters, no code.

## How skills work

SWEny workflows are directed acyclic graphs (DAGs). At each node in the graph, you declare which skills are available. When the executor reaches that node, it gathers the tools from those skills and hands them to Claude. Claude calls the tools as needed to complete the node's instruction, then the executor evaluates edge conditions to decide what runs next.

```yaml
nodes:
  gather:
    name: Gather Context
    instruction: Pull error details and recent commits...
    skills: [github, sentry, datadog]
```

In this example, the `gather` node has access to all tools from the GitHub, Sentry, and Datadog skills. Claude can search code, query errors, and pull log data — all within a single node.

## Auto-configuration

Skills resolve their configuration from environment variables. If the required env vars are set, the skill is available. There is no registration step.

```bash
# Set these and the GitHub + Sentry skills are ready
export GITHUB_TOKEN="ghp_..."
export SENTRY_AUTH_TOKEN="sntrys_..."
export SENTRY_ORG="my-org"
```

The `configuredSkills()` helper returns only the skills whose required env vars are present. The executor uses this to build the tool set for each node at runtime.

## Skill categories

Every skill belongs to a category. Categories are used for validation — the executor checks that each node has at least one configured skill per category it needs.

| Category | Purpose | Skills |
|----------|---------|--------|
| `git` | Source control | [GitHub](/skills/github/) |
| `observability` | Logs, errors, metrics, incidents | [Sentry](/skills/sentry/), [Datadog](/skills/datadog/), [BetterStack](/skills/betterstack/) |
| `tasks` | Issue tracking | [Linear](/skills/linear/) |
| `notification` | Alerting the team | [Slack](/skills/slack/), [Notification](/skills/notification/) |
| `data` | Embeddings, vector stores, databases, ETL | (custom skills) |
| `general` | Catch-all when no other category fits | (custom skills) |

## Built-in skills

| ID | Name | Category | Required env vars |
|----|------|----------|-------------------|
| `github` | [GitHub](/skills/github/) | git | `GITHUB_TOKEN` |
| `linear` | [Linear](/skills/linear/) | tasks | `LINEAR_API_KEY` |
| `sentry` | [Sentry](/skills/sentry/) | observability | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` |
| `datadog` | [Datadog](/skills/datadog/) | observability | `DD_API_KEY`, `DD_APP_KEY` |
| `betterstack` | [BetterStack](/skills/betterstack/) | observability | `BETTERSTACK_API_TOKEN` |
| `slack` | [Slack](/skills/slack/) | notification | `SLACK_WEBHOOK_URL` or `SLACK_BOT_TOKEN` |
| `notification` | [Notification](/skills/notification/) | notification | `DISCORD_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `NOTIFICATION_WEBHOOK_URL`, or `SMTP_URL` |

## Validation

Before executing a workflow, SWEny validates that every node's skill requirements can be satisfied. For each node, it groups the declared skills by category and checks that at least one skill per category is configured.

Missing notification skills produce warnings. Missing skills in other categories produce errors that block execution.

Run `sweny check` to verify your configuration without executing a workflow.

```bash
npx sweny check --workflow triage
```

## Skills in code

```ts
import { github, sentry, slack, createSkillMap, configuredSkills } from "@sweny-ai/core";

// Explicit skill map
const skills = createSkillMap([github, sentry, slack]);

// Or auto-detect from environment
const skills = createSkillMap(configuredSkills());

await execute(workflow, input, { skills, claude });
```

## Custom Skills

In addition to built-in skills, you can create custom instruction skills and MCP-backed skills. See the [Custom Skills guide](/skills/custom/) for details on:

- Creating `SKILL.md` files with instruction content
- Declaring MCP server integrations
- Inline workflow skill definitions
- Multi-harness skill discovery
