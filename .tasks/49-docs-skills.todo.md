# Task: Write Skills Section (8 pages)

## Goal
Write the Skills overview page + one page per built-in skill. These are configuration reference pages.

## Key framing
Skills are tool groups that wire into workflow nodes. SWEny's value is the DAG orchestration — skills are the connectors that give Claude access to your tools at each step.

## Pages to write

All pages go in `packages/web/src/content/docs/skills/`.

### 1. `index.md` — Skills Overview
- What a skill is: a logical group of tools that share configuration
- Skills replace the old "providers" concept
- How skills wire into workflows: each node lists skill IDs → executor gathers tools from those skills → Claude calls tools as needed
- Auto-configuration: skills resolve config from environment variables. If the required env vars are set, the skill is available.
- Skill categories: git, observability, tasks, notification, general
- Table of all built-in skills: ID, Name, Category, Required env vars
- Validation: `sweny check` verifies all configured skills can connect
- Custom skills: not yet supported (coming soon) — use MCP servers for custom tool integrations

### 2. `github.md` — GitHub
- **ID**: `github` | **Category**: `git`
- **Config**: `GITHUB_TOKEN` (required) — personal access token or app installation token
- **Tools** (7):
  | Tool | Description |
  |------|-------------|
  | `github_search_code` | Search for code in a repository |
  | `github_get_issue` | Get details of an issue |
  | `github_search_issues` | Search issues and PRs |
  | `github_create_issue` | Create a new issue |
  | `github_create_pr` | Create a pull request |
  | `github_list_recent_commits` | List recent commits on a branch |
  | `github_get_file` | Get a file's contents |
- **Used in**: Both triage and implement workflows (source control + issue tracking)
- **Setup**: Create a fine-grained PAT with repo access, or use `${{ github.token }}` in Actions

### 3. `linear.md` — Linear
- **ID**: `linear` | **Category**: `tasks`
- **Config**: `LINEAR_API_KEY` (required)
- **Tools** (3):
  | Tool | Description |
  |------|-------------|
  | `linear_create_issue` | Create a new Linear issue |
  | `linear_search_issues` | Search issues by text query |
  | `linear_update_issue` | Update an existing issue |
- **Used in**: Triage workflow (create_issue node), Implement workflow (analyze node)
- **Setup**: Generate API key at Linear Settings > API

### 4. `sentry.md` — Sentry
- **ID**: `sentry` | **Category**: `observability`
- **Config**: `SENTRY_AUTH_TOKEN` (required), `SENTRY_ORG` (required), `SENTRY_BASE_URL` (optional, default: https://sentry.io)
- **Tools** (4):
  | Tool | Description |
  |------|-------------|
  | `sentry_list_issues` | List recent issues for a project |
  | `sentry_get_issue` | Get detailed info about an issue |
  | `sentry_get_issue_events` | Get recent events for an issue |
  | `sentry_search_events` | Search events using Discover syntax |
- **Used in**: Triage workflow (gather node)
- **Setup**: Create auth token at Sentry Settings > Auth Tokens

### 5. `datadog.md` — Datadog
- **ID**: `datadog` | **Category**: `observability`
- **Config**: `DD_API_KEY` (required), `DD_APP_KEY` (required), `DD_SITE` (optional, default: datadoghq.com)
- **Tools** (3):
  | Tool | Description |
  |------|-------------|
  | `datadog_search_logs` | Search logs |
  | `datadog_query_metrics` | Query time-series metrics |
  | `datadog_list_monitors` | List monitors (filter by name/tags) |
- **Setup**: Create API + App keys at Datadog Organization Settings

### 6. `betterstack.md` — BetterStack
- **ID**: `betterstack` | **Category**: `observability`
- **Config**: `BETTERSTACK_API_TOKEN` (required)
- **Tools** (5):
  | Tool | Description |
  |------|-------------|
  | `betterstack_list_incidents` | List recent incidents |
  | `betterstack_get_incident` | Get incident details + timeline |
  | `betterstack_list_monitors` | List all uptime monitors |
  | `betterstack_get_monitor` | Get monitor details + status |
  | `betterstack_list_on_call` | List who is currently on-call |
- **Setup**: Get API token from BetterStack Uptime > Settings > API

### 7. `slack.md` — Slack
- **ID**: `slack` | **Category**: `notification`
- **Config**: `SLACK_WEBHOOK_URL` (optional), `SLACK_BOT_TOKEN` (optional) — at least one required
- **Tools** (2):
  | Tool | Description |
  |------|-------------|
  | `slack_send_message` | Send a message via webhook or API |
  | `slack_send_thread_reply` | Reply to a thread (requires bot token) |
- Bot token enables: channel targeting, thread replies, richer formatting
- Webhook is simpler: just set up an incoming webhook URL
- **Setup**: Either create an Incoming Webhook in Slack, or create a Slack App with `chat:write` scope

### 8. `notification.md` — Notification
- **ID**: `notification` | **Category**: `notification`
- **Config**: `NOTIFICATION_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `SMTP_URL` — all optional, configure whichever channels you use
- **Tools** (3):
  | Tool | Description |
  |------|-------------|
  | `notify_webhook` | Send JSON to a webhook URL |
  | `notify_discord` | Send to Discord (with embeds) |
  | `notify_teams` | Send to Microsoft Teams (MessageCard) |
- Use this skill for non-Slack notifications. For Slack, use the dedicated Slack skill.

## Source of truth
- `packages/core/src/skills/*.ts` — each skill's definition, config, and tools
- `packages/core/src/skills/index.ts` — registry and validation helpers
- `packages/core/src/types.ts` — Skill, Tool, ConfigField interfaces
