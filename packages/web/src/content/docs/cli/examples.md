---
title: CLI Examples
description: Common SWEny CLI configurations and real-world recipes.
---

## Local-only mode (no external services)

The fastest way to try SWEny. Point it at a local log file and run entirely offline:

```yaml
# .sweny.yml
observability-provider: file
log-file: ./sample-errors.json
issue-tracker-provider: file
source-control-provider: file
notification-provider: file
output-dir: .sweny/output
```

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
sweny triage --dry-run
```

Output goes to `.sweny/output/`:
- `issues/LOCAL-1.md` -- issue tickets
- `prs/pr-1.md` -- PR descriptions
- `notifications/summary-*.md` -- run summaries

## Datadog with GitHub Issues

The most common production setup:

```yaml
# .sweny.yml
observability-provider: datadog
issue-tracker-provider: github-issues
source-control-provider: github
time-range: 4h
severity-focus: errors
```

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
DD_API_KEY=your-api-key
DD_APP_KEY=your-app-key
GITHUB_TOKEN=ghp_...
```

```bash
sweny triage
```

## Sentry with Linear

```yaml
# .sweny.yml
observability-provider: sentry
sentry-org: my-org
sentry-project: my-project
issue-tracker-provider: linear
linear-team-id: your-team-uuid
```

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
SENTRY_AUTH_TOKEN=sntrys_...
LINEAR_API_KEY=lin_api_...
GITHUB_TOKEN=ghp_...
```

```bash
sweny triage
```

## GitLab with Jira

```yaml
# .sweny.yml
observability-provider: datadog
source-control-provider: gitlab
issue-tracker-provider: jira
gitlab-base-url: https://gitlab.mycompany.com
```

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
DD_API_KEY=your-api-key
DD_APP_KEY=your-app-key
GITLAB_TOKEN=glpat-...
GITLAB_PROJECT_ID=my-group/my-project
JIRA_BASE_URL=https://mycompany.atlassian.net
JIRA_EMAIL=bot@mycompany.com
JIRA_API_TOKEN=your-token
```

```bash
sweny triage
```

## Dry run (analyze only)

Analyze errors without creating issues or PRs. Useful for validating your setup or reviewing what the agent would do:

```bash
sweny triage --dry-run
```

## Filter to a specific service

Only investigate errors from billing services in the last 4 hours:

```bash
sweny triage \
  --service-filter 'billing-*' \
  --time-range 4h \
  --severity-focus errors
```

## Thorough investigation with more turns

Give the agent more room to explore complex issues:

```bash
sweny triage \
  --investigation-depth thorough \
  --max-investigate-turns 100 \
  --max-implement-turns 50 \
  --time-range 7d
```

## Work on a specific existing issue

Point the triage workflow at an existing issue instead of scanning for new ones:

```bash
sweny triage \
  --issue-override 'ENG-123' \
  --additional-instructions 'Focus on the webhook handler timeout'
```

## Implement a fix for a tracked issue

Run the implement workflow directly on a known issue -- skips log scanning entirely:

```bash
sweny implement ENG-123
```

Pass additional guidance to the coding agent:

```bash
sweny implement ENG-123 \
  --additional-instructions 'Add a null check before accessing event.payload.metadata'
```

Use a different base branch:

```bash
sweny implement ENG-456 --base-branch develop
```

## JSON output for scripting

Pipe structured output to other tools:

```bash
# Full JSON result
sweny triage --dry-run --json | jq .

# Extract specific fields
sweny triage --json | jq 'to_entries[] | select(.value.status == "success") | .key'
```

:::note[Output routing]
With `--json`, structured results go to stdout while progress output is suppressed. Without `--json`, progress rendering goes to stderr so stdout stays clean for redirection.
:::

## Run a custom workflow

Execute a workflow defined in a YAML file:

```bash
sweny workflow run my-workflow.yml
```

Validate first without running:

```bash
sweny workflow run my-workflow.yml --dry-run
```

## Generate a workflow from a prompt

Describe what you want in plain English and let the LLM build the workflow:

```bash
sweny workflow create "check for slow database queries and file tickets"
```

The CLI generates the workflow, renders a DAG preview, and asks if you want to save, refine, or discard. Save it and run it:

```bash
sweny workflow run .sweny/workflows/check-slow-queries.yml
```

For non-interactive use (CI, scripts), pass `--json`:

```bash
sweny workflow create "monitor API latency and alert on regressions" --json > workflow.json
```

## Edit a workflow with natural language

Modify an existing workflow without hand-editing YAML:

```bash
sweny workflow edit my-workflow.yml "add a Slack notification after creating tickets"
```

Or start an interactive session:

```bash
sweny workflow edit my-workflow.yml
```

## Export a built-in workflow for customization

Use a built-in workflow as a starting point:

```bash
sweny workflow export triage > my-triage.yml
```

Edit the exported file, then run it:

```bash
sweny workflow run my-triage.yml
```

Both `triage` and `implement` are available:

```bash
sweny workflow export implement > my-implement.yml
```

## List available skills

See what skills are available for workflow nodes:

```bash
sweny workflow list
```

Machine-readable output:

```bash
sweny workflow list --json | jq '.[].id'
```

## Slack notifications

Send triage results to a Slack channel:

```yaml
# .sweny.yml
notification-provider: slack
```

```bash
# .env
NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/...
```

```bash
sweny triage
```

## Inline credentials (quick testing)

For one-off runs, pass credentials inline without editing `.env`:

```bash
SENTRY_AUTH_TOKEN=sntrys_... sweny triage \
  --observability-provider sentry \
  --sentry-org my-org \
  --sentry-project my-project \
  --time-range 6h \
  --dry-run
```

## Validate a workflow in CI

Add a validation step to your CI pipeline:

```bash
sweny workflow validate .sweny/workflows/*.yml
```

With JSON output for programmatic checks:

```bash
sweny workflow validate my-workflow.yml --json
# {"valid": true, "errors": []}
```

## Stream events for Studio Live Mode

Use `--stream` to emit NDJSON `ExecutionEvent` objects to stdout. This is how Studio connects to a running workflow:

```bash
sweny triage --stream 2>/dev/null | ws-broadcast
```

`--stream` works alongside the normal progress display — events go to stdout, the spinner goes to stderr:

```bash
sweny workflow run my-workflow.yml --stream > events.jsonl
```

You can also combine `--stream` with `--json` to get both the event stream during execution and the final results:

```bash
sweny implement ENG-123 --stream > events.jsonl
```

## Bell notification on completion

Ring the terminal bell when a long-running workflow finishes:

```bash
sweny triage --bell
```
