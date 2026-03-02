---
title: Action Inputs
description: All configuration inputs for the SWEny Triage GitHub Action.
---

## Authentication

| Input | Description | Required |
|-------|-------------|----------|
| `claude-oauth-token` | Claude Code OAuth token (Max/Pro subscriptions) | Recommended |
| `anthropic-api-key` | Anthropic API key (pay-per-use) | Alternative |

Most users should use `claude-oauth-token`. The `anthropic-api-key` option is available for direct API billing.

## Observability

| Input | Description | Default |
|-------|-------------|---------|
| `observability-provider` | Provider to use (`datadog`, `sentry`, `cloudwatch`, `splunk`, `elastic`, `newrelic`, `loki`) | `datadog` |
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
| `notification-provider` | Provider to use (`github-summary`, `slack`, `teams`, `discord`, `email`, `webhook`) | `github-summary` |
| `notification-webhook-url` | Webhook URL for Slack, Teams, Discord, or generic webhook | — |
| `sendgrid-api-key` | SendGrid API key (when `notification-provider` is `email`) | — |
| `email-from` | Sender email address (when `notification-provider` is `email`) | — |
| `email-to` | Recipient email addresses, comma-separated | — |
| `webhook-signing-secret` | HMAC-SHA256 signing secret for generic webhook notifications | — |

## Behavior

| Input | Description | Default |
|-------|-------------|---------|
| `dry-run` | Analyze only, don't create PRs | `false` |
| `novelty-mode` | Only report issues not already tracked | `true` |
| `linear-issue` | Work on a specific Linear issue (e.g., `ENG-123`) | — |
| `additional-instructions` | Extra guidance for the agent | — |
| `service-map-path` | Path to service ownership map | `.github/service-map.yml` |
| `base-branch` | Target branch for PRs | `main` |
| `pr-labels` | Comma-separated labels to apply to created PRs | `agent,triage,needs-review` |
| `github-token` | GitHub token for PRs | `${{ github.token }}` |
| `bot-token` | Token with cross-repo permissions | — |
