---
title: CLI Examples
description: Common SWEny CLI configurations and recipes.
---

## Test with a local log file

The fastest way to try SWEny. Create `.sweny.yml` and `.env`:

```yaml
# .sweny.yml
observability-provider: file
log-file: ./logs/errors.json
```

```bash
# .env
CLAUDE_CODE_OAUTH_TOKEN=your-token
```

```bash
sweny triage --dry-run
```

## Datadog with GitHub Issues

The most common production setup:

```yaml
# .sweny.yml
observability-provider: datadog
time-range: 4h
severity-focus: errors
```

```bash
# .env
CLAUDE_CODE_OAUTH_TOKEN=your-token
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
linear-team-id: team-uuid
```

```bash
# .env
CLAUDE_CODE_OAUTH_TOKEN=your-token
SENTRY_AUTH_TOKEN=your-token
LINEAR_API_KEY=lin_api_...
GITHUB_TOKEN=ghp_...
```

```bash
sweny triage
```

## Filter to a specific service

Only investigate errors from billing services in the last 4 hours:

```bash
sweny triage \
  --service-filter 'billing-*' \
  --time-range 4h \
  --severity-focus errors \
  --dry-run
```

## Work on a specific issue

Point SWEny at an existing issue instead of scanning for new ones:

```bash
sweny triage \
  --issue-override 'ENG-123' \
  --additional-instructions 'Focus on the webhook handler timeout'
```

## Thorough investigation with more turns

Give the agent more room to explore:

```bash
sweny triage \
  --investigation-depth thorough \
  --max-investigate-turns 100 \
  --max-implement-turns 50 \
  --time-range 7d
```

## JSON output for scripting

Pipe structured output to other tools:

```bash
# Get just the status
sweny triage --dry-run --json | jq '.status'

# Extract issue URLs
sweny triage --json | jq '[.steps[] | select(.name == "create-issue") | .result.data.issueUrl]'
```

## GitLab with Jira

```yaml
# .sweny.yml
observability-provider: datadog
source-control-provider: gitlab
issue-tracker-provider: jira
```

```bash
# .env
CLAUDE_CODE_OAUTH_TOKEN=your-token
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

## Resume after a crash

Step caching means you don't lose progress. If the workflow crashes after `investigate` completes (3+ minutes), re-run the same command and cached steps replay instantly:

```bash
# First run — crashes at step 4
sweny triage --dry-run
  ✓ [3/9] investigate         3m 6s   → cached
  ✗ [4/9] novelty-gate               → crash

# Re-run — steps 1-3 replay from cache
sweny triage --dry-run
  ↻ [3/9] investigate         cached
  ✓ [4/9] novelty-gate           1s   → runs fresh
```

Force a fresh run with `--no-cache`:

```bash
sweny triage --dry-run --no-cache
```

## Slack notifications

Send triage results to a Slack channel:

```bash
export NOTIFICATION_WEBHOOK_URL="https://hooks.slack.com/services/..."

sweny triage --notification-provider slack
```

See [Notification Providers](/providers/notification/) for Teams, Discord, email, and generic webhook support.
