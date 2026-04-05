---
title: CLI Examples
description: Real-world workflows and configurations — from one-liners to complex pipelines.
---

## Create workflows from natural language

The fastest way to get things done. Describe your task and SWEny builds a complete workflow:

### Content generation with quality gates

```bash
sweny workflow create "generate SEO blog posts for each topic in our \
  content calendar, run each through an LLM quality judge that checks \
  readability, accuracy, and keyword density, loop back for rewrites \
  if quality fails, then publish passing content"
```

### Security audit

```bash
sweny workflow create "scan recent commits for exposed secrets, review \
  open PRs for security-sensitive changes, check dependency files for \
  known vulnerabilities, compile a security posture report, and create \
  Linear tickets for any critical findings"
```

### Competitive analysis

```bash
sweny workflow create "research the top 5 competitors in our space, \
  gather pricing models, key features, and target audience for each, \
  synthesize a competitive analysis comparing them across dimensions, \
  and produce an executive brief with strategic recommendations"
```

### Product launch planning

```bash
sweny workflow create "research recent product launches for lessons \
  learned, draft launch copy with a tagline, 3 value props, and a tweet, \
  create a launch checklist as Linear issues, and compile a launch brief"
```

### Refine any workflow with natural language

```bash
# Add a quality gate with loop-back logic
sweny workflow edit .sweny/workflows/launch_planner.yml \
  "add a quality gate after drafting copy that rejects taglines over \
  10 words or vague value props — loop back to redraft if rejected"

# Add notification steps
sweny workflow edit .sweny/workflows/security_audit.yml \
  "add a Slack notification after creating tickets"
```

## Run and manage workflows

```bash
# Run a workflow
sweny workflow run .sweny/workflows/my-workflow.yml

# Dry run (validate structure, don't execute)
sweny workflow run .sweny/workflows/my-workflow.yml --dry-run

# Validate without running
sweny workflow validate .sweny/workflows/my-workflow.yml

# Export a built-in workflow for customization
sweny workflow export triage > my-triage.yml

# List available skills
sweny workflow list
```

---

## Local-only mode (no external services)

The fastest way to try the built-in triage workflow. Point it at a local log file and run entirely offline:

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

---

## E2E browser testing

Generate AI-driven end-to-end tests for any web app. No Playwright scripts — the AI agent drives a real browser.

### Set up e2e tests with the wizard

```bash
sweny e2e init
```

The wizard asks which flows to test (registration, login, purchase, onboarding, upgrade, cancellation, custom), per-flow details, and whether to auto-cleanup test data. It generates workflow YAML files in `.sweny/e2e/`.

### Run all e2e tests

```bash
sweny e2e run
```

Executes every `.yml` in `.sweny/e2e/` sequentially. Auto-generates test credentials (`e2e-{timestamp}@yourapp.test`), resolves template variables, and reports pass/fail per workflow.

### Run a specific test

```bash
sweny e2e run registration.yml
```

### Custom timeout for slow flows

```bash
sweny e2e run --timeout 600000   # 10 minutes per workflow
```

### Test with a staging environment

```bash
# .env
E2E_BASE_URL=https://staging.myapp.com
E2E_EMAIL=test@example.com
E2E_PASSWORD=secret
```

```bash
sweny e2e run
```

**[Full E2E guide](/cli/e2e/)** — wizard details, template variables, cleanup backends, and generated workflow structure.
