---
title: Inputs & Outputs
description: Complete reference for all SWEny GitHub Action inputs and outputs.
---

Every input listed here corresponds to an entry in [`action.yml`](https://github.com/swenyai/sweny/blob/main/action.yml). All inputs are optional -- SWEny provides sensible defaults so you only need to configure the providers you use.

## Workflow

| Input | Description | Default |
|-------|-------------|---------|
| `workflow` | Workflow to run: `triage` (scan logs, investigate, create issues and PRs) or `implement` (work on a specific issue, skip log scanning) | `triage` |

## Authentication

| Input | Description | Default |
|-------|-------------|---------|
| `anthropic-api-key` | Anthropic API key for Claude (pay-per-use billing) | -- |
| `claude-oauth-token` | Claude Code OAuth token from a Max/Pro subscription (predictable monthly cost) | -- |
| `github-token` | GitHub token for API access and PR creation | `${{ github.token }}` |
| `bot-token` | Optional bot token with elevated permissions for cross-repo dispatch or pushing to protected branches | -- |

You must provide either `anthropic-api-key` or `claude-oauth-token`. The `github-token` is auto-provided by GitHub Actions.

## Coding Agent

| Input | Description | Default |
|-------|-------------|---------|
| `coding-agent-provider` | Agent to use for implementation: `claude`, `codex`, or `gemini` | `claude` |
| `openai-api-key` | OpenAI API key (required when `coding-agent-provider` is `codex`) | -- |
| `gemini-api-key` | Google Gemini API key (required when `coding-agent-provider` is `gemini`) | -- |

## Observability

| Input | Description | Default |
|-------|-------------|---------|
| `observability-provider` | Provider to query for logs, errors, and metrics | `datadog` |

Supported values: `datadog`, `sentry`, `cloudwatch`, `splunk`, `elastic`, `newrelic`, `loki`, `honeycomb`, `axiom`, `heroku`, `opsgenie`, `pagerduty`, `prometheus`, `vercel`, `supabase`, `netlify`, `fly`, `render`, `file`.

### Datadog

| Input | Description | Default |
|-------|-------------|---------|
| `dd-api-key` | Datadog API key | -- |
| `dd-app-key` | Datadog Application key | -- |
| `dd-site` | Datadog site (e.g., `datadoghq.com`, `datadoghq.eu`) | `datadoghq.com` |

### Sentry

| Input | Description | Default |
|-------|-------------|---------|
| `sentry-auth-token` | Sentry auth token | -- |
| `sentry-org` | Sentry organization slug | -- |
| `sentry-project` | Sentry project slug | -- |
| `sentry-base-url` | Sentry base URL (for self-hosted instances) | `https://sentry.io` |

### CloudWatch

| Input | Description | Default |
|-------|-------------|---------|
| `cloudwatch-region` | AWS region for CloudWatch Logs | `us-east-1` |
| `cloudwatch-log-group-prefix` | CloudWatch log group name or prefix | -- |

:::note[AWS credentials]
CloudWatch uses the standard AWS credential chain. Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as repository secrets, or use [OIDC federation](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) for keyless auth.
:::

### Splunk

| Input | Description | Default |
|-------|-------------|---------|
| `splunk-url` | Splunk REST API base URL (e.g., `https://splunk.example.com:8089`) | -- |
| `splunk-token` | Splunk authentication token | -- |
| `splunk-index` | Splunk index to search | `main` |

### Elasticsearch

| Input | Description | Default |
|-------|-------------|---------|
| `elastic-url` | Elasticsearch base URL (e.g., `https://elastic.example.com:9200`) | -- |
| `elastic-api-key` | Elasticsearch API key | -- |
| `elastic-index` | Elasticsearch index pattern | `logs-*` |

### New Relic

| Input | Description | Default |
|-------|-------------|---------|
| `newrelic-api-key` | New Relic API key (`NRAK-...`) | -- |
| `newrelic-account-id` | New Relic account ID | -- |
| `newrelic-region` | New Relic region: `us` or `eu` | `us` |

### Grafana Loki

| Input | Description | Default |
|-------|-------------|---------|
| `loki-url` | Loki base URL (e.g., `https://loki.example.com`) | -- |
| `loki-api-key` | Loki API key (optional for unauthenticated instances) | -- |
| `loki-org-id` | Loki tenant/org ID (optional) | -- |

### Honeycomb

| Input | Description | Default |
|-------|-------------|---------|
| `honeycomb-api-key` | Honeycomb API key | -- |
| `honeycomb-dataset` | Honeycomb dataset name | -- |

### Axiom

| Input | Description | Default |
|-------|-------------|---------|
| `axiom-api-token` | Axiom API token | -- |
| `axiom-dataset` | Axiom dataset name | -- |
| `axiom-org-id` | Axiom org ID (required for multi-org accounts) | -- |

### PagerDuty

| Input | Description | Default |
|-------|-------------|---------|
| `pagerduty-api-key` | PagerDuty API key | -- |

### OpsGenie

| Input | Description | Default |
|-------|-------------|---------|
| `opsgenie-api-key` | OpsGenie API key | -- |
| `opsgenie-region` | OpsGenie region: `us` or `eu` | `us` |

### Prometheus

| Input | Description | Default |
|-------|-------------|---------|
| `prometheus-url` | Prometheus base URL (e.g., `http://prometheus.internal:9090`) | -- |
| `prometheus-token` | Prometheus bearer token (optional, for secured instances) | -- |

### Vercel

| Input | Description | Default |
|-------|-------------|---------|
| `vercel-token` | Vercel personal access token | -- |
| `vercel-project-id` | Vercel project ID (`prj_...`) | -- |
| `vercel-team-id` | Vercel team ID (`team_...`, optional for team-owned projects) | -- |

### Supabase

| Input | Description | Default |
|-------|-------------|---------|
| `supabase-management-key` | Supabase management API key | -- |
| `supabase-project-ref` | Supabase project reference ID | -- |

### Netlify

| Input | Description | Default |
|-------|-------------|---------|
| `netlify-token` | Netlify personal access token | -- |
| `netlify-site-id` | Netlify site ID (find in Site Settings > General) | -- |

### Fly.io

| Input | Description | Default |
|-------|-------------|---------|
| `fly-token` | Fly.io personal access token | -- |
| `fly-app-name` | Fly.io application name | -- |

### Render

| Input | Description | Default |
|-------|-------------|---------|
| `render-api-key` | Render API key | -- |
| `render-service-id` | Render service ID (`srv-...`) | -- |

### Heroku

| Input | Description | Default |
|-------|-------------|---------|
| `heroku-api-key` | Heroku API key | -- |
| `heroku-app-name` | Heroku application name | -- |

### File

| Input | Description | Default |
|-------|-------------|---------|
| `log-file-path` | Path to a local JSON log file | -- |

Use the `file` provider for testing without connecting to an external service.

## Issue Tracking

| Input | Description | Default |
|-------|-------------|---------|
| `issue-tracker-provider` | Issue tracker to use: `github-issues`, `linear`, or `jira` | `github-issues` |

### Linear

| Input | Description | Default |
|-------|-------------|---------|
| `linear-api-key` | Linear API key | -- |
| `linear-team-id` | Linear team UUID | -- |
| `linear-bug-label-id` | Linear label UUID for bugs | -- |
| `linear-triage-label-id` | Linear label UUID for agent-triage issues | -- |
| `linear-state-backlog` | Linear workflow state UUID for Backlog | -- |
| `linear-state-in-progress` | Linear workflow state UUID for In Progress | -- |
| `linear-state-peer-review` | Linear workflow state UUID for Peer Review | -- |

Only `linear-api-key` and `linear-team-id` are required. The label and state UUIDs are optional and let you control where issues land in your workflow.

### Jira

| Input | Description | Default |
|-------|-------------|---------|
| `jira-base-url` | Jira base URL (e.g., `https://myco.atlassian.net`) | -- |
| `jira-email` | Jira user email for API authentication | -- |
| `jira-api-token` | Jira API token | -- |

### GitHub Issues

GitHub Issues requires no extra configuration. It uses the `github-token` input, which is auto-provided by GitHub Actions.

## Source Control

| Input | Description | Default |
|-------|-------------|---------|
| `source-control-provider` | Source control provider: `github` or `gitlab` | `github` |
| `gitlab-token` | GitLab personal access token | -- |
| `gitlab-project-id` | GitLab project ID or path (e.g., `my-group/my-project`) | -- |
| `gitlab-base-url` | GitLab instance base URL | `https://gitlab.com` |

## Notification

| Input | Description | Default |
|-------|-------------|---------|
| `notification-provider` | Where to send results: `github-summary`, `slack`, `teams`, `discord`, `email`, `webhook`, or `file` | `github-summary` |
| `notification-webhook-url` | Webhook URL (required for `slack`, `teams`, `discord`, and `webhook` providers) | -- |
| `sendgrid-api-key` | SendGrid API key (required when `notification-provider` is `email`) | -- |
| `email-from` | Sender email address (required when `notification-provider` is `email`) | -- |
| `email-to` | Recipient email addresses, comma-separated (required when `notification-provider` is `email`) | -- |
| `webhook-signing-secret` | HMAC-SHA256 signing secret for generic webhook notifications | -- |
| `output-dir` | Directory for file-based provider output (dry-run and `file` provider artifacts) | `.github/sweny-output` |

## Investigation

| Input | Description | Default |
|-------|-------------|---------|
| `time-range` | Time window to analyze (e.g., `1h`, `6h`, `24h`, `7d`) | `24h` |
| `severity-focus` | What to focus on: `errors`, `warnings`, or `all` | `errors` |
| `service-filter` | Service filter pattern (e.g., `my-service`, `api-*`, `*`) | `*` |
| `investigation-depth` | How deep the agent should investigate: `quick`, `standard`, or `thorough` | `standard` |
| `max-investigate-turns` | Maximum Claude turns for the investigation phase (1--500) | `50` |
| `max-implement-turns` | Maximum Claude turns for the implementation phase (1--500) | `30` |

:::note[Matching time-range to your schedule]
If you run triage on a daily cron, set `time-range: 24h`. If you run every 6 hours, use `time-range: 6h`. This avoids investigating the same errors twice.
:::

## PR Settings

| Input | Description | Default |
|-------|-------------|---------|
| `base-branch` | Target branch for PRs (e.g., `main`, `master`, `develop`) | `main` |
| `pr-labels` | Comma-separated list of labels to apply to created PRs | `agent,triage,needs-review` |

## Behavior

| Input | Description | Default |
|-------|-------------|---------|
| `dry-run` | Analyze only -- the executor stops at the first conditional edge, guaranteeing zero side effects. Enforced by the executor, not by prompt. | `false` |
| `review-mode` | PR merge behavior: `auto` (enable GitHub auto-merge when CI passes, automatically suppressed for high-risk changes like migrations, auth, lockfiles, or >20 files) or `review` (open PR and wait for human approval) | `review` |
| `novelty-mode` | Only report novel issues not already tracked in your issue tracker | `true` |
| `linear-issue` | Existing issue identifier to work on (e.g., `ENG-123`). Required for the `implement` workflow. Equivalent to `--issue-override` in the CLI | -- |
| `additional-instructions` | Extra guidance for the agent (e.g., `"focus on the webhook handler"`) | -- |

## Service Map

| Input | Description | Default |
|-------|-------------|---------|
| `service-map-path` | Path to the service ownership map YAML file | `.github/service-map.yml` |

See [Service Map](/action/service-map/) for the file format and usage guide.

## Workspace Tools

| Input | Description | Default |
|-------|-------------|---------|
| `workspace-tools` | Comma-separated list of workspace integrations to enable. Each tool injects its MCP server when the corresponding credential environment variable is present | -- |

Supported values: `slack`, `notion`, `pagerduty`, `monday`, `asana`.

Example: `workspace-tools: "slack,notion"`

## MCP Servers

| Input | Description | Default |
|-------|-------------|---------|
| `mcp-servers` | Additional MCP servers as a JSON object. Each key is a server name; each value is an `MCPServerConfig` with fields: `type`, `command`, `args`, `env`, `url`, `headers` | -- |

Provider-based MCP servers (GitHub, Linear, Datadog) are injected automatically based on your configured providers -- you do not need to add them here.

```yaml
mcp-servers: |
  {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem@latest", "/workspace"]
    }
  }
```

See [MCP Servers](/advanced/mcp-servers/) for the full server catalog.

---

## Outputs

After the workflow completes, SWEny sets these outputs on the action step. Use them in subsequent workflow steps with `${{ steps.<step-id>.outputs.<output> }}`.

| Output | Description | Example |
|--------|-------------|---------|
| `issues-found` | Whether any issues were found during investigation | `true` |
| `recommendation` | Investigation recommendation | `implement`, `+1 existing ENG-456`, `skip` |
| `issue-identifier` | Issue identifier from the configured tracker | `ENG-123`, `#42` |
| `issue-url` | URL of the created or found issue | `https://linear.app/team/issue/ENG-123` |
| `pr-url` | URL of the created pull request | `https://github.com/org/repo/pull/99` |
| `pr-number` | Number of the created pull request | `99` |

### Using outputs in subsequent steps

```yaml
jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: swenyai/sweny@v5
        id: sweny
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          dd-api-key: ${{ secrets.DD_API_KEY }}
          dd-app-key: ${{ secrets.DD_APP_KEY }}

      - name: Post to Slack if issues found
        if: steps.sweny.outputs.issues-found == 'true'
        run: |
          curl -X POST "${{ secrets.SLACK_WEBHOOK }}" \
            -H 'Content-type: application/json' \
            -d '{"text": "SWEny found issues: ${{ steps.sweny.outputs.issue-url }}"}'
```
