---
title: CLI Examples
description: Common SWEny CLI configurations and recipes.
---

## Test with a local log file

Analyze a JSON log file without any external service credentials:

```bash
export CLAUDE_CODE_OAUTH_TOKEN="your-token"

sweny triage \
  --observability-provider file \
  --log-file ./logs/errors.json \
  --dry-run
```

## Datadog with GitHub Issues

The most common setup — scan Datadog for errors and create GitHub Issues:

```bash
export CLAUDE_CODE_OAUTH_TOKEN="your-token"
export DD_API_KEY="your-api-key"
export DD_APP_KEY="your-app-key"
export GITHUB_TOKEN="ghp_..."

sweny triage --time-range 4h --severity-focus errors
```

## Sentry with Linear

Use Sentry for error tracking and Linear for issue management:

```bash
export CLAUDE_CODE_OAUTH_TOKEN="your-token"
export SENTRY_AUTH_TOKEN="your-token"
export LINEAR_API_KEY="lin_api_..."
export GITHUB_TOKEN="ghp_..."

sweny triage \
  --observability-provider sentry \
  --sentry-org my-org \
  --sentry-project my-project \
  --issue-tracker-provider linear \
  --linear-team-id "team-uuid"
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

Use GitLab for source control and Jira for issue tracking:

```bash
export CLAUDE_CODE_OAUTH_TOKEN="your-token"
export DD_API_KEY="your-api-key"
export DD_APP_KEY="your-app-key"
export GITLAB_TOKEN="glpat-..."
export GITLAB_PROJECT_ID="my-group/my-project"
export JIRA_BASE_URL="https://mycompany.atlassian.net"
export JIRA_EMAIL="bot@mycompany.com"
export JIRA_API_TOKEN="your-token"

sweny triage \
  --source-control-provider gitlab \
  --issue-tracker-provider jira
```

## Using an .env file

Keep credentials in a `.env` file (remember to `.gitignore` it):

```bash
# .env
CLAUDE_CODE_OAUTH_TOKEN=your-token
DD_API_KEY=your-api-key
DD_APP_KEY=your-app-key
GITHUB_TOKEN=ghp_...
```

Then run with your preferred env loader:

```bash
# Using tsx
npx tsx --env-file=.env node_modules/.bin/sweny triage --dry-run

# Using dotenv
npx dotenv -- sweny triage --dry-run

# Using direnv (auto-loads .envrc)
sweny triage --dry-run
```

## Slack notifications

Send triage results to a Slack channel:

```bash
export NOTIFICATION_WEBHOOK_URL="https://hooks.slack.com/services/..."

sweny triage --notification-provider slack
```

See [Notification Providers](/providers/notification/) for Teams, Discord, email, and generic webhook support.
