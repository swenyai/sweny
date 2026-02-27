---
title: Action Outputs
description: Outputs from the SWEny Triage GitHub Action.
---

After a triage run, these outputs are available for subsequent workflow steps:

| Output | Description |
|--------|-------------|
| `issues-found` | Whether issues were found (`true` / `false`) |
| `recommendation` | What SWEny decided (`implement`, `+1 existing ENG-123`, `skip`) |
| `issue-identifier` | Linear issue created or found (e.g., `ENG-456`) |
| `issue-url` | Linear issue URL |
| `pr-url` | Pull request URL (if created) |
| `pr-number` | Pull request number (if created) |

## Using outputs in your workflow

```yaml
steps:
  - uses: swenyai/sweny@v0.1
    id: triage
    with:
      claude-oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
      # ... other inputs

  - if: steps.triage.outputs.pr-url != ''
    run: echo "PR created at ${{ steps.triage.outputs.pr-url }}"

  - if: steps.triage.outputs.recommendation == 'skip'
    run: echo "No novel issues found"
```
