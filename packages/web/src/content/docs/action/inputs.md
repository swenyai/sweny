---
title: Inputs
description: Complete reference for the inputs of the SWEny GitHub Action (swenyai/sweny).
---

[`swenyai/sweny@v5`](https://github.com/swenyai/sweny) runs any SWEny workflow YAML. This table is checked against [`action.yml`](https://github.com/swenyai/sweny/blob/main/action.yml) in CI.

The separate [`swenyai/triage`](https://github.com/swenyai/triage#readme) and [`swenyai/e2e`](https://github.com/swenyai/e2e#readme) actions have their own inputs; see their READMEs.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `workflow` | Path to the workflow YAML file to execute (relative to working-directory). | Yes | -- |
| `claude-oauth-token` | Claude Code OAuth token. Use this OR anthropic-api-key. OAuth tokens do not consume API credit. | No | -- |
| `anthropic-api-key` | Anthropic API key for Claude (x-api-key). Use this OR claude-oauth-token. | No | -- |
| `anthropic-auth-token` | Bearer token (Authorization: Bearer) for gateways that expect it. Sets ANTHROPIC_AUTH_TOKEN. Distinct from anthropic-api-key (x-api-key). | No | -- |
| `anthropic-base-url` | Anthropic-compatible base URL (e.g. a LiteLLM gateway). Sets ANTHROPIC_BASE_URL. See docs: Using a model gateway. | No | -- |
| `sweny-auth` | Auth mode: auto (default), api-key, or oauth. Set 'api-key' to authenticate a gateway with anthropic-api-key / anthropic-auth-token even when an OAuth token is also present. | No | `auto` |
| `agent` | Coding agent that runs the nodes: claude (default) or codex. codex needs openai-api-key and installs the Codex CLI (@openai/codex). | No | `claude` |
| `openai-api-key` | OpenAI API key for agent: codex. Passed to Codex as CODEX_API_KEY. | No | -- |
| `codex-version` | Version of @openai/codex to install when agent is codex. Defaults to the version sweny's Codex capability claims were tested against (TESTED_CODEX_VERSION in harness/codex.ts). sweny needs 0.159.0 or newer; a newer Codex runs with a warning. Set 'latest' to opt in to untested versions. | No | `0.159.2` |
| `harness-policy` | strict refuses a node whose policy the agent cannot enforce (for example tools.deny: [write] on codex); warn runs it and reports it in the receipt. Empty uses the CLI default, which is strict under GitHub Actions. | No | -- |
| `cli-version` | Version of @sweny-ai/core to install (the package that ships the `sweny` CLI). On the v5 and v5.&lt;version&gt; tags this defaults to the exact core version that release was tested with; a branch ref such as @main defaults to latest. Set 'latest' to opt in to untested versions. | No | `latest` |
| `node-version` | Node.js version to install. | No | `24` |
| `working-directory` | Working directory to run the workflow from. Defaults to the repository root. | No | `.` |
| `setup-only` | When 'true', install and probe the agent and its sandbox, then stop without running the workflow or calling a model. For CI that proves a runner can host an agent. | No | `false` |
| `dry-run` | When 'true', run with read-only tools only: write tools, external MCP servers, and shell/file-edit tools are withheld, so nothing is created, posted, or sent (the PR comment and failure notification are skipped too). Stops at the first natural-language conditional edge. | No | `false` |
| `timeout` | Whole-run wall-clock budget in milliseconds, forwarded to `sweny workflow run --timeout`. Empty uses the CLI default (3600000 = 60 min). Use 0 for no wall-clock budget. | No | -- |
| `max-steps` | Hard cap on total node executions (including eval-failure retries), forwarded to `sweny workflow run --max-steps`. Empty uses the CLI default (200). | No | -- |
| `max-tokens` | Run-wide token budget (input plus output tokens), forwarded to `sweny workflow run --max-tokens` only when set. The lowest of this and the workflow's `budget.tokens` wins. A crossing stops the agent, fails the node, and halts the run. Fails the step on a CLI too old to enforce it, so a cap is never silently dropped. | No | -- |
| `max-cost` | Run-wide cost budget in US dollars, forwarded to `sweny workflow run --max-cost` only when set. Uses harness-reported cost (never estimated). The lowest of this and the workflow's `budget.cost_usd` wins. Fails the step on a CLI too old to enforce it. | No | -- |
| `verbose` | When 'true', print each tool call's input and output inline. Truncated for readability; use the CLI's --stream flag locally for full untruncated NDJSON. Helpful for debugging a node that halts or fails. | No | `false` |
| `show-output` | When 'true', print the workflow's final answer in the job log. Off by default: in CI the CLI prints only the path of the saved answer (.sweny/runs/&lt;run-id&gt;/output.md), because job logs are often readable by more people than the repo's secrets. The answer is redacted either way. Forwarded as `--show-output` only when set. | No | `false` |
| `input` | JSON object of per-run inputs for the workflow. Forwarded verbatim to `sweny workflow run --input '<json>'`. When the workflow declares an `inputs` block, the CLI validates this string against the declaration (type-check, required-field check, default-fill) and fails with a readable diff when the shape doesn't match. When the workflow does NOT declare `inputs`, the JSON is passed through unchanged for back-compat. | No | -- |
| `pr-comment` | Post or update one sticky comment on the pull request with the run receipt, a status-colored Mermaid DAG, and per-node status and duration. Metadata only: no prompts, tool inputs, or model output. Only acts on pull_request events (no-op on every other event). Uses the job's GITHUB_TOKEN, so the job needs `permissions: pull-requests: write` (fork PRs get a read-only token, so the post is skipped with a warning). A failed post warns and never fails the job. Set to 'false' to opt out. Requires an @sweny-ai/core version that supports `--comment-file`. | No | `true` |
| `notify-on-failure` | Tell someone when the run fails or is refused, and only then. Set to `issue` to open (or comment on) one sticky issue per workflow labelled `sweny-failure` (the job needs `permissions: issues: write`), or to a Slack incoming-webhook: pass the URL from a secret, or the NAME of an env var on this step that holds it (for example SLACK_WEBHOOK_URL). Metadata only: workflow id, failed node ids, a reason class (node_failed, crashed, did_not_start), and the run link. Never error text or model output. A failed notification warns and never fails the job. Empty (the default) sends nothing. Needs no CLI support. | No | -- |
| `cloud-token` | Project token (sweny_pk_...) enabling opt-in run reporting. Optional, and not currently available. Token minting is not yet exposed, so leaving this unset (the default) means no outbound reporting request is made. Equivalent to setting the SWENY_CLOUD_TOKEN env var; either form is accepted. | No | -- |

With `agent: claude` you must provide either `claude-oauth-token` or `anthropic-api-key`; with `agent: codex`, `openai-api-key`.

#### PR comment

A workflow that posts findings on the PR needs `pull-requests: write` on the job's `GITHUB_TOKEN`. A job that only writes the job summary does not:

```yaml
permissions:
  contents: read
  pull-requests: write
```

SWEny is quiet by default. The run receipt (cost, tokens, duration, policy) and the status-colored DAG go to the **job summary**, never to the PR thread. That includes `--json` runs and crashed runs.

When a workflow comments on the pull request it runs for (a `comment` safe output or the GitHub skill's `github_add_comment`), SWEny keeps **one comment per workflow per PR** and edits it in place:

- It finds the comment by the hidden first line `<!-- sweny-run-comment:<workflow-id> -->` (the id percent-encoded), and only among comments written by the account the skill's `GITHUB_TOKEN` posts as: the token's user for a PAT, `github-actions[bot]` for the job's `github.token`, or your app's bot. A marked comment from anyone else is ignored.
- The sticky billboard older versions posted was written with the job's `github.token`, so it becomes the findings comment only when the skill's `GITHUB_TOKEN` is also `github.token`. With a PAT or an app token, SWEny starts a new comment and the old billboard stays as it was.
- If SWEny cannot tell which account the token posts as, the job summary says so. It then skips the write when a bot already left this workflow's marked comment, rather than post a duplicate.
- The comment holds the findings and one **Run receipt** link to the Actions run.
- Empty findings post nothing.
- Findings unchanged since the last post are not written again. The comparison strips SWEny's markers and the receipt link, and ignores line endings, trailing whitespace and runs of blank lines.
- Each run adds one line to the job summary saying what it did: posted, updated, or skipped and why.
- If one run writes to the comment twice (two nodes each post a comment on the PR), the last write wins.

The PR is the one the runner names (`PR_NUMBER`, which the Action sets, or `GITHUB_REF` on a `pull_request` event) in the run's own repository (`GITHUB_REPOSITORY`). Nothing in the workflow input or the agent's request can point the updating comment at another PR or repository. Only that comment is pinned this way: a comment on any other issue or PR is posted as a new comment, as before, wherever the workflow's own rules allow.

`pr-comment: false` skips the Action's comment step. It does not stop comments a workflow asks for itself; to stop those, remove the workflow's comment output or make it read-only.

On other CI systems, `--comment-file comment.md` is still accepted and writes an empty file. Read run details from the job summary.

Pass any additional credentials your workflow needs via `env:` on the step — the CLI auto-loads environment variables.

---

## Triage action inputs

[`swenyai/triage@v1`](https://github.com/swenyai/triage) — the full triage preset with observability, issue tracking, notification, and investigation inputs.

### Authentication

| Input | Description | Default |
|-------|-------------|---------|
| `anthropic-api-key` | Anthropic API key for Claude (pay-per-use billing) | -- |
| `claude-oauth-token` | Claude Code OAuth token from a Max/Pro subscription (predictable monthly cost) | -- |
| `github-token` | GitHub token for API access and PR creation | `${{ github.token }}` |
| `bot-token` | Optional bot token with elevated permissions for cross-repo dispatch or pushing to protected branches | -- |

You must provide either `anthropic-api-key` or `claude-oauth-token`. The `github-token` is auto-provided by GitHub Actions.

### Coding Agent

| Input | Description | Default |
|-------|-------------|---------|
| `agent` | Agent backend. Only `claude` (headless Claude Code) is supported; other values are rejected. | `claude` |

### Observability

| Input | Description | Default |
|-------|-------------|---------|
| `observability-provider` | Provider to query for logs, errors, and metrics | `datadog` |

Supported values: `datadog`, `sentry`, `betterstack`, `cloudwatch`, `splunk`, `elastic`, `newrelic`, `loki`, `honeycomb`, `axiom`, `heroku`, `opsgenie`, `pagerduty`, `prometheus`, `vercel`, `supabase`, `netlify`, `fly`, `render`, `file`.

#### Datadog

| Input | Description | Default |
|-------|-------------|---------|
| `dd-api-key` | Datadog API key | -- |
| `dd-app-key` | Datadog Application key | -- |
| `dd-site` | Datadog site (e.g., `datadoghq.com`, `datadoghq.eu`) | `datadoghq.com` |

#### Sentry

| Input | Description | Default |
|-------|-------------|---------|
| `sentry-auth-token` | Sentry auth token | -- |
| `sentry-org` | Sentry organization slug | -- |
| `sentry-project` | Sentry project slug | -- |
| `sentry-base-url` | Sentry base URL (for self-hosted instances) | `https://sentry.io` |

#### CloudWatch

| Input | Description | Default |
|-------|-------------|---------|
| `cloudwatch-region` | AWS region for CloudWatch Logs | `us-east-1` |
| `cloudwatch-log-group-prefix` | CloudWatch log group name or prefix | -- |

:::note[AWS credentials]
CloudWatch uses the standard AWS credential chain. Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as repository secrets, or use [OIDC federation](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) for keyless auth.
:::

#### BetterStack

| Input | Description | Default |
|-------|-------------|---------|
| `betterstack-api-token` | Better Stack API token | -- |
| `betterstack-source-id` | Better Stack Telemetry source ID | -- |
| `betterstack-table-name` | Better Stack Telemetry ClickHouse table name | -- |

#### Splunk

| Input | Description | Default |
|-------|-------------|---------|
| `splunk-url` | Splunk REST API base URL (e.g., `https://splunk.example.com:8089`) | -- |
| `splunk-token` | Splunk authentication token | -- |
| `splunk-index` | Splunk index to search | `main` |

#### Elasticsearch

| Input | Description | Default |
|-------|-------------|---------|
| `elastic-url` | Elasticsearch base URL (e.g., `https://elastic.example.com:9200`) | -- |
| `elastic-api-key` | Elasticsearch API key | -- |
| `elastic-index` | Elasticsearch index pattern | `logs-*` |

#### New Relic

| Input | Description | Default |
|-------|-------------|---------|
| `newrelic-api-key` | New Relic API key (`NRAK-...`) | -- |
| `newrelic-account-id` | New Relic account ID | -- |
| `newrelic-region` | New Relic region: `us` or `eu` | `us` |

#### Grafana Loki

| Input | Description | Default |
|-------|-------------|---------|
| `loki-url` | Loki base URL (e.g., `https://loki.example.com`) | -- |
| `loki-api-key` | Loki API key (optional for unauthenticated instances) | -- |
| `loki-org-id` | Loki tenant/org ID (optional) | -- |

#### Honeycomb

| Input | Description | Default |
|-------|-------------|---------|
| `honeycomb-api-key` | Honeycomb API key | -- |
| `honeycomb-dataset` | Honeycomb dataset name | -- |

#### Axiom

| Input | Description | Default |
|-------|-------------|---------|
| `axiom-api-token` | Axiom API token | -- |
| `axiom-dataset` | Axiom dataset name | -- |
| `axiom-org-id` | Axiom org ID (required for multi-org accounts) | -- |

#### PagerDuty

| Input | Description | Default |
|-------|-------------|---------|
| `pagerduty-api-key` | PagerDuty API key | -- |

#### OpsGenie

| Input | Description | Default |
|-------|-------------|---------|
| `opsgenie-api-key` | OpsGenie API key | -- |
| `opsgenie-region` | OpsGenie region: `us` or `eu` | `us` |

#### Prometheus

| Input | Description | Default |
|-------|-------------|---------|
| `prometheus-url` | Prometheus base URL (e.g., `http://prometheus.internal:9090`) | -- |
| `prometheus-token` | Prometheus bearer token (optional, for secured instances) | -- |

#### Vercel

| Input | Description | Default |
|-------|-------------|---------|
| `vercel-token` | Vercel personal access token | -- |
| `vercel-project-id` | Vercel project ID (`prj_...`) | -- |
| `vercel-team-id` | Vercel team ID (`team_...`, optional for team-owned projects) | -- |

#### Supabase

| Input | Description | Default |
|-------|-------------|---------|
| `supabase-management-key` | Supabase management API key | -- |
| `supabase-project-ref` | Supabase project reference ID | -- |

#### Netlify

| Input | Description | Default |
|-------|-------------|---------|
| `netlify-token` | Netlify personal access token | -- |
| `netlify-site-id` | Netlify site ID (find in Site Settings > General) | -- |

#### Fly.io

| Input | Description | Default |
|-------|-------------|---------|
| `fly-token` | Fly.io personal access token | -- |
| `fly-app-name` | Fly.io application name | -- |

#### Render

| Input | Description | Default |
|-------|-------------|---------|
| `render-api-key` | Render API key | -- |
| `render-service-id` | Render service ID (`srv-...`) | -- |

#### Heroku

| Input | Description | Default |
|-------|-------------|---------|
| `heroku-api-key` | Heroku API key | -- |
| `heroku-app-name` | Heroku application name | -- |

#### File

| Input | Description | Default |
|-------|-------------|---------|
| `log-file-path` | Path to a local JSON log file | -- |

Use the `file` provider for testing without connecting to an external service.

### Issue Tracking

| Input | Description | Default |
|-------|-------------|---------|
| `issue-tracker-provider` | Issue tracker to use: `github-issues`, `linear`, or `jira` | `github-issues` |

#### Linear

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

#### Jira

| Input | Description | Default |
|-------|-------------|---------|
| `jira-base-url` | Jira base URL (e.g., `https://myco.atlassian.net`) | -- |
| `jira-email` | Jira user email for API authentication | -- |
| `jira-api-token` | Jira API token | -- |

#### GitHub Issues

GitHub Issues requires no extra configuration. It uses the `github-token` input, which is auto-provided by GitHub Actions.

### Source Control

| Input | Description | Default |
|-------|-------------|---------|
| `source-control-provider` | Source control provider: `github` or `gitlab` | `github` |
| `gitlab-token` | GitLab personal access token | -- |
| `gitlab-project-id` | GitLab project ID or path (e.g., `my-group/my-project`) | -- |
| `gitlab-base-url` | GitLab instance base URL | `https://gitlab.com` |

### Notification

| Input | Description | Default |
|-------|-------------|---------|
| `notification-provider` | Where to send results: `github-summary`, `slack`, `teams`, `discord`, `email`, `webhook`, or `file` | `github-summary` |
| `notification-webhook-url` | Webhook URL (required for `slack`, `teams`, `discord`, and `webhook` providers) | -- |
| `sendgrid-api-key` | SendGrid API key (required when `notification-provider` is `email`) | -- |
| `email-from` | Sender email address (required when `notification-provider` is `email`) | -- |
| `email-to` | Recipient email addresses, comma-separated (required when `notification-provider` is `email`) | -- |
| `webhook-signing-secret` | HMAC-SHA256 signing secret for generic webhook notifications | -- |
| `output-dir` | Directory for file-based provider output (dry-run and `file` provider artifacts) | `.github/sweny-output` |

### Investigation

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

### PR Settings

| Input | Description | Default |
|-------|-------------|---------|
| `base-branch` | Target branch for PRs (e.g., `main`, `master`, `develop`) | `main` |
| `pr-labels` | Comma-separated list of labels to apply to created PRs | `agent,triage,needs-review` |

### Behavior

| Input | Description | Default |
|-------|-------------|---------|
| `dry-run` | Analyze only -- the executor runs every node read-only and stops at the first natural-language conditional edge. Enforced by the executor, not by prompt. | `false` |
| `review-mode` | PR merge behavior: `auto` (enable GitHub auto-merge when CI passes, automatically suppressed for high-risk changes like migrations, auth, lockfiles, or >20 files) or `review` (open PR and wait for human approval) | `review` |
| `novelty-mode` | Only report novel issues not already tracked in your issue tracker | `true` |
| `issue-override` | Existing issue identifier to work on (e.g., `ENG-123`). Skips log scanning and works directly on this issue. | -- |
| `additional-instructions` | Extra guidance for the agent (e.g., `"focus on the webhook handler"`) | -- |

### Service Map

| Input | Description | Default |
|-------|-------------|---------|
| `service-map-path` | Path to the service ownership map YAML file | `.github/service-map.yml` |

See [Service Map](/action/service-map/) for the file format and usage guide.

### Workspace Tools

| Input | Description | Default |
|-------|-------------|---------|
| `workspace-tools` | Comma-separated list of workspace integrations to enable. Each tool injects its MCP server when the corresponding credential environment variable is present | -- |

Supported values: `slack`, `notion`, `pagerduty`, `monday`, `asana`.

Example: `workspace-tools: "slack,notion"`

### MCP Servers

| Input | Description | Default |
|-------|-------------|---------|
| `mcp-servers-json` | Additional MCP servers as a JSON object. Each key is a server name; each value is an `MCPServerConfig` with fields: `type`, `command`, `args`, `env`, `url`, `headers` | -- |

Provider-based MCP servers (GitHub, Linear, Datadog) are injected automatically based on your configured providers -- you do not need to add them here.

```yaml
mcp-servers-json: |
  {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem@latest", "/workspace"]
    }
  }
```

See [MCP Servers](/advanced/mcp-servers/) for the full server catalog.

### Setup

| Input | Description | Default |
|-------|-------------|---------|
| `cli-version` | Version of `@sweny-ai/core` to install | `latest` |
| `node-version` | Node.js version to install | `24` |
| `working-directory` | Working directory to run from | `.` |

---

## Triage outputs

After the triage workflow completes, SWEny sets these outputs on the action step. Use them in subsequent workflow steps with `${{ steps.<step-id>.outputs.<output> }}`.

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
          persist-credentials: false
          fetch-depth: 0

      - uses: swenyai/triage@v1
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

---

## E2E action inputs

[`swenyai/e2e@v1`](https://github.com/swenyai/e2e) — runs agentic browser tests against a deployed app.

| Input | Description | Default |
|-------|-------------|---------|
| `workflow` | Path to the E2E workflow YAML file to execute | **required** |
| `claude-oauth-token` | Claude Code OAuth token | -- |
| `anthropic-api-key` | Anthropic API key for Claude | -- |
| `base-url` | Base URL of the deployed app under test (exposed as `BASE_URL`) | -- |
| `cli-version` | Version of `@sweny-ai/core` to install | `latest` |
| `agent-browser-version` | Version of `agent-browser` to install | `latest` |
| `node-version` | Node.js version to install | `24` |
| `working-directory` | Working directory to run from | `.` |
| `screenshots-path` | Path where the workflow writes screenshots and artifacts | `results/` |
| `artifact-name` | Name of the uploaded screenshots artifact | `e2e-screenshots` |
| `artifact-retention-days` | How long to retain the screenshots artifact (days) | `14` |

You must provide either `claude-oauth-token` or `anthropic-api-key`.
