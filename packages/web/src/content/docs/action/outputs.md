---
title: Action Outputs
description: Outputs from the SWEny Triage GitHub Action.
---

After a triage run, these outputs are available for subsequent workflow steps. Use them to chain SWEny into larger workflows — post to Slack, update a dashboard, or gate a deployment.

| Output | Type | Description |
|--------|------|-------------|
| `issues-found` | `"true"` / `"false"` | Whether SWEny found novel issues in the logs |
| `recommendation` | `string` | What SWEny decided: `implement`, `+1 existing ENG-123`, or `skip` |
| `issue-identifier` | `string` | Issue created or found (e.g., `ENG-456`). Empty if skipped |
| `issue-url` | `string` | Full URL to the issue. Empty if skipped |
| `pr-url` | `string` | Pull request URL. Empty if dry-run or no fix was written |
| `pr-number` | `string` | Pull request number. Empty if no PR was created |

## Recommendation values

| Value | Meaning |
|-------|---------|
| `implement` | SWEny found a novel issue, filed a ticket, and opened a PR |
| `+1 existing ENG-123` | A matching issue already exists — SWEny added an occurrence comment |
| `skip` | No novel issues found above the threshold |

## Using outputs in your workflow

### Notify Slack when a PR is created

```yaml
steps:
  - uses: swenyai/sweny@v0.2
    id: triage
    with:
      claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
      # ... other inputs

  - if: steps.triage.outputs.pr-url != ''
    uses: slackapi/slack-github-action@v2
    with:
      webhook: ${{ secrets.SLACK_WEBHOOK }}
      webhook-type: incoming-webhook
      payload: |
        text: "SWEny opened a fix: ${{ steps.triage.outputs.pr-url }} for ${{ steps.triage.outputs.issue-identifier }}"
```

### Skip deployment if issues were found

```yaml
  - if: steps.triage.outputs.issues-found == 'true'
    run: |
      echo "::warning::SWEny found issues — review ${{ steps.triage.outputs.issue-url }} before deploying"

  - if: steps.triage.outputs.recommendation == 'skip'
    run: echo "All clear — no novel issues"
```
