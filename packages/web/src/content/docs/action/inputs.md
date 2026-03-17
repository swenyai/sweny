---
title: Action Inputs
description: All configuration inputs for the SWEny Triage GitHub Action.
---

## Workflow selection

| Input | Description | Default |
|-------|-------------|---------|
| `workflow` | Workflow to run (`triage`, `implement`) | `triage` |

The `triage` workflow scans logs, investigates error patterns, and opens fix PRs. The `implement` workflow skips log scanning and works directly on a specified issue — set `linear-issue` (or `issue-identifier`) to target it.

## Authentication

| Input | Description | Required |
|-------|-------------|----------|
| `claude-oauth-token` | Claude Code OAuth token (Max/Pro subscriptions) | Recommended |
| `anthropic-api-key` | Anthropic API key (pay-per-use) | Alternative |

Most users should use `claude-oauth-token`. The `anthropic-api-key` option is available for direct API billing.

## Coding Agent

| Input | Description | Default |
|-------|-------------|---------|
| `coding-agent-provider` | Agent to use for implementation (`claude`, `codex`, `gemini`) | `claude` |
| `openai-api-key` | OpenAI API key (required when `coding-agent-provider` is `codex`) | — |
| `gemini-api-key` | Google Gemini API key (required when `coding-agent-provider` is `gemini`) | — |

## Observability

| Input | Description | Default |
|-------|-------------|---------|
| `observability-provider` | Provider to use (`datadog`, `sentry`, `cloudwatch`, `splunk`, `elastic`, `newrelic`, `loki`, `file`) | `datadog` |
| `dd-api-key` | Datadog API key | — |
| `dd-app-key` | Datadog Application key | — |
| `dd-site` | Datadog site | `datadoghq.com` |
| `sentry-auth-token` | Sentry auth token | — |
| `sentry-org` | Sentry organization slug | — |
| `sentry-project` | Sentry project slug | — |
| `sentry-base-url` | Sentry base URL | `https://sentry.io` |
| `cloudwatch-region` | AWS region for CloudWatch | `us-east-1` |
| `cloudwatch-log-group-prefix` | CloudWatch log group prefix | — |
| `splunk-url` | Splunk REST API base URL | — |
| `splunk-token` | Splunk authentication token | — |
| `splunk-index` | Splunk index to query | `main` |
| `elastic-url` | Elasticsearch base URL | — |
| `elastic-api-key` | Elasticsearch API key | — |
| `elastic-index` | Elasticsearch index pattern | `logs-*` |
| `newrelic-api-key` | New Relic API key | — |
| `newrelic-account-id` | New Relic account ID | — |
| `newrelic-region` | New Relic region (`us` or `eu`) | `us` |
| `loki-url` | Grafana Loki base URL | — |
| `loki-api-key` | Grafana Loki API key | — |
| `loki-org-id` | Grafana Loki tenant/org ID | — |
| `log-file-path` | Path to a local JSON log file (required when `observability-provider` is `file`) | — |

## Issue Tracker

| Input | Description | Default |
|-------|-------------|---------|
| `issue-tracker-provider` | Provider to use (`linear`, `github-issues`, `jira`) | `github-issues` |
| `linear-api-key` | Linear API key | — |
| `linear-team-id` | Linear team UUID | — |
| `linear-bug-label-id` | Label UUID for bugs | — |
| `linear-triage-label-id` | Label UUID for agent-triage | — |
| `linear-state-backlog` | State UUID for Backlog | — |
| `linear-state-in-progress` | State UUID for In Progress | — |
| `linear-state-peer-review` | State UUID for Peer Review | — |
| `jira-base-url` | Jira instance URL (e.g. `https://mycompany.atlassian.net`) | — |
| `jira-email` | Jira bot account email | — |
| `jira-api-token` | Jira API token | — |

Note: `github-issues` uses the existing `github-token` input for authentication.

## Source Control

| Input | Description | Default |
|-------|-------------|---------|
| `source-control-provider` | Provider to use (`github`, `gitlab`) | `github` |
| `gitlab-token` | GitLab personal access token | — |
| `gitlab-project-id` | GitLab project path (e.g. `my-group/my-project`) | — |
| `gitlab-base-url` | GitLab instance URL | `https://gitlab.com` |

## Investigation

| Input | Description | Default |
|-------|-------------|---------|
| `time-range` | Time window to analyze (`1h`, `6h`, `24h`, `7d`) | `24h` |
| `severity-focus` | What to look for (`errors`, `warnings`, `all`) | `errors` |
| `service-filter` | Service pattern (`my-svc`, `api-*`, `*`) | `*` |
| `investigation-depth` | How deep the agent investigates (`quick`, `standard`, `thorough`) | `standard` |
| `max-investigate-turns` | Max agent turns for investigation | `50` |
| `max-implement-turns` | Max agent turns for implementation | `30` |

## Notification

| Input | Description | Default |
|-------|-------------|---------|
| `notification-provider` | Provider to use (`github-summary`, `slack`, `teams`, `discord`, `email`, `webhook`, `file`) | `github-summary` |
| `notification-webhook-url` | Webhook URL — required for `slack`, `teams`, `discord`, or `webhook` providers | — |
| `sendgrid-api-key` | SendGrid API key (when `notification-provider` is `email`) | — |
| `email-from` | Sender email address (when `notification-provider` is `email`) | — |
| `email-to` | Recipient email addresses, comma-separated | — |
| `webhook-signing-secret` | HMAC-SHA256 signing secret for generic webhook notifications | — |
| `output-dir` | Directory for file-based provider output (`file` notification, dry-run artifacts) | `.github/sweny-output` |

## Behavior

| Input | Description | Default |
|-------|-------------|---------|
| `dry-run` | Analyze only, don't create PRs | `false` |
| `review-mode` | PR merge behaviour: `auto` (enable GitHub auto-merge when CI passes — suppressed automatically for high-risk changes such as migrations, auth, or >20 files) or `review` (open PR and wait for human approval) | `review` |
| `novelty-mode` | Skip issues already tracked in the configured issue tracker. Set to `false` to re-investigate regardless of existing tickets | `true` |
| `linear-issue` | Identifier of an existing issue to work on (e.g., `ENG-123`). Skips log investigation and runs the implement workflow directly | — |
| `additional-instructions` | Extra guidance for the agent | — |
| `service-map-path` | Path to service ownership map | `.github/service-map.yml` |
| `base-branch` | Target branch for PRs | `main` |
| `pr-labels` | Comma-separated labels to apply to created PRs | `agent,triage,needs-review` |
| `github-token` | GitHub token for API access and PR creation | `${{ github.token }}` |
| `bot-token` | Optional bot token with elevated permissions (cross-repo dispatch, protected branch pushes) | — |

## Workspace tools & MCP servers

| Input | Description | Default |
|-------|-------------|---------|
| `workspace-tools` | Comma-separated workspace integrations to enable (`slack`, `notion`, `pagerduty`, `monday`). Each tool injects its MCP server into the coding agent when the corresponding credential env var is present | — |
| `mcp-servers` | Additional MCP servers as a JSON object. Each key is a server name; each value is an `MCPServerConfig` (`type`, `command`, `args`, `env`, `url`, `headers`). Provider-based MCP servers (GitHub, Linear, Datadog) are injected automatically | — |

See [MCP Servers](/providers/mcp-servers/) for the full server catalog and configuration reference.
