---
title: CLI Inputs
description: All flags and environment variables for the SWEny CLI.
---

The CLI accepts configuration through flags and environment variables. Secrets (API keys, tokens) are always read from environment variables — never passed as flags.

## Authentication

| Environment Variable | Description | Required |
|---------------------|-------------|----------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth token (Max/Pro subscriptions) | Recommended |
| `ANTHROPIC_API_KEY` | Anthropic API key (pay-per-use) | Alternative |

At least one authentication method is required.

## Observability

| Flag | Description | Default |
|------|-------------|---------|
| `--observability-provider` | Provider to use (`datadog`, `sentry`, `cloudwatch`, `splunk`, `elastic`, `newrelic`, `loki`, `file`) | `datadog` |
| `--log-file` | Path to JSON log file (use with `--observability-provider file`) | — |
| `--dd-site` | Datadog site | `datadoghq.com` |
| `--sentry-org` | Sentry organization slug | — |
| `--sentry-project` | Sentry project slug | — |
| `--sentry-base-url` | Sentry base URL | `https://sentry.io` |
| `--cloudwatch-region` | AWS CloudWatch region | `us-east-1` |
| `--cloudwatch-log-group-prefix` | CloudWatch log group prefix | — |
| `--splunk-index` | Splunk index | `main` |
| `--elastic-index` | Elasticsearch index pattern | `logs-*` |
| `--newrelic-region` | New Relic region (`us` or `eu`) | `us` |

| Environment Variable | Description | Provider |
|---------------------|-------------|----------|
| `DD_API_KEY` | Datadog API key | `datadog` |
| `DD_APP_KEY` | Datadog Application key | `datadog` |
| `DD_SITE` | Datadog site (fallback for `--dd-site`) | `datadog` |
| `SENTRY_AUTH_TOKEN` | Sentry auth token | `sentry` |
| `SPLUNK_URL` | Splunk REST API base URL | `splunk` |
| `SPLUNK_TOKEN` | Splunk authentication token | `splunk` |
| `ELASTIC_URL` | Elasticsearch base URL | `elastic` |
| `ELASTIC_API_KEY` | Elasticsearch API key | `elastic` |
| `NR_API_KEY` | New Relic API key | `newrelic` |
| `NR_ACCOUNT_ID` | New Relic account ID | `newrelic` |
| `LOKI_URL` | Grafana Loki base URL | `loki` |
| `LOKI_API_KEY` | Grafana Loki API key | `loki` |
| `LOKI_ORG_ID` | Grafana Loki tenant/org ID | `loki` |

The `file` provider reads a local JSON file and requires no credentials — ideal for testing.

## Issue Tracker

| Flag | Description | Default |
|------|-------------|---------|
| `--issue-tracker-provider` | Provider to use (`github-issues`, `linear`, `jira`) | `github-issues` |
| `--linear-team-id` | Linear team UUID | — |
| `--linear-bug-label-id` | Label UUID for bugs | — |
| `--linear-triage-label-id` | Label UUID for agent-triage | — |
| `--linear-state-backlog` | State name for Backlog | — |
| `--linear-state-in-progress` | State name for In Progress | — |
| `--linear-state-peer-review` | State name for Peer Review | — |

| Environment Variable | Description | Provider |
|---------------------|-------------|----------|
| `GITHUB_TOKEN` | GitHub token | `github-issues` |
| `LINEAR_API_KEY` | Linear API key | `linear` |
| `LINEAR_TEAM_ID` | Linear team UUID (fallback for `--linear-team-id`) | `linear` |
| `JIRA_BASE_URL` | Jira instance URL | `jira` |
| `JIRA_EMAIL` | Jira bot account email | `jira` |
| `JIRA_API_TOKEN` | Jira API token | `jira` |

Note: The CLI defaults to `github-issues` (the GitHub Action defaults to `linear`).

## Source Control

| Flag | Description | Default |
|------|-------------|---------|
| `--source-control-provider` | Provider to use (`github`, `gitlab`) | `github` |
| `--gitlab-base-url` | GitLab instance URL | `https://gitlab.com` |

| Environment Variable | Description | Provider |
|---------------------|-------------|----------|
| `GITHUB_TOKEN` | GitHub token for PRs | `github` |
| `BOT_TOKEN` | Token with cross-repo permissions | `github` |
| `GITLAB_TOKEN` | GitLab personal access token | `gitlab` |
| `GITLAB_PROJECT_ID` | GitLab project path | `gitlab` |

## Investigation

| Flag | Description | Default |
|------|-------------|---------|
| `--time-range` | Time window to analyze (`1h`, `6h`, `24h`, `7d`) | `24h` |
| `--severity-focus` | What to look for (`errors`, `warnings`, `all`) | `errors` |
| `--service-filter` | Service pattern (`my-svc`, `api-*`, `*`) | `*` |
| `--investigation-depth` | How deep the agent investigates (`quick`, `standard`, `thorough`) | `standard` |
| `--max-investigate-turns` | Max agent turns for investigation | `50` |
| `--max-implement-turns` | Max agent turns for implementation | `30` |

## Behavior

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Analyze only, don't create issues or PRs | `false` |
| `--no-novelty-mode` | Allow +1 on existing issues (disable deduplication) | novelty on |
| `--issue-override` | Work on a specific existing issue (e.g., `ENG-123`) | — |
| `--additional-instructions` | Extra guidance for the agent | — |
| `--service-map-path` | Path to service ownership map | `.github/service-map.yml` |
| `--repository` | Repository as `owner/repo` (auto-detected from git remote) | auto |
| `--base-branch` | Base branch for PRs | `main` |
| `--pr-labels` | Comma-separated PR labels | `agent,triage,needs-review` |
| `--json` | Output results as JSON | `false` |

## Notification

| Flag | Description | Default |
|------|-------------|---------|
| `--notification-provider` | Provider to use (`console`, `slack`, `teams`, `discord`, `email`, `webhook`) | `console` |

| Environment Variable | Description | Provider |
|---------------------|-------------|----------|
| `NOTIFICATION_WEBHOOK_URL` | Webhook URL | `slack`, `teams`, `discord`, `webhook` |
| `SENDGRID_API_KEY` | SendGrid API key | `email` |
| `EMAIL_FROM` | Sender email address | `email` |
| `EMAIL_TO` | Recipient email address(es), comma-separated | `email` |
| `WEBHOOK_SIGNING_SECRET` | HMAC signing secret for webhook payloads | `webhook` |

The CLI defaults to `console` — results are printed to stdout.
