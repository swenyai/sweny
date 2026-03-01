---
title: Examples
description: Common SWEny Triage configurations.
---

## Scheduled triage with dry-run

Analyze errors without creating PRs — useful for testing your setup:

```yaml
- uses: swenyai/sweny@v0.2
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
    dry-run: true
    time-range: '7d'
    investigation-depth: 'thorough'
```

## Work on a specific Linear issue

Point SWEny at an existing ticket instead of scanning for new issues:

```yaml
- uses: swenyai/sweny@v0.2
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-issue: 'ENG-123'
    additional-instructions: 'Focus on the webhook handler timeout'
```

## Filter to a specific service

Only look at errors from a subset of services:

```yaml
- uses: swenyai/sweny@v0.2
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
    service-filter: 'billing-*'
    severity-focus: 'errors'
    time-range: '4h'
```

## Required permissions

Your workflow needs these permissions for SWEny to create branches and PRs:

```yaml
permissions:
  contents: write
  pull-requests: write
```

If using cross-repo dispatch, pass a `bot-token` with `repo` and `actions` scopes for the target repositories.
