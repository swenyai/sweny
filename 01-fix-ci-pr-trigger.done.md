# Task: Fix CI trigger gap in continuous-improvement workflow

## Problem

`continuous-improvement.yml` passes `github-token: ${{ github.token }}` to the sweny action.
When the action creates GitHub Issues or Pull Requests using that token, the author is
`github-actions[bot]`. GitHub's security policy intentionally prevents PRs created by
`github-actions[bot]` from triggering `pull_request` CI events. This means every fix PR
SWEny opens skips CI entirely — the core self-healing loop is broken.

## Solution

Replace `github.token` with a Personal Access Token (PAT) stored as `secrets.GH_PAT`
wherever the sweny action needs to create issues/PRs. The PAT author is a real user
account, so PRs will trigger CI normally.

The Python step that collects CI failure logs uses `GH_TOKEN: ${{ github.token }}` — that
is fine and should remain unchanged (it only reads, doesn't create PRs).

## File to edit

`/Users/nate/src/swenyai/sweny/.github/workflows/continuous-improvement.yml`

In the "Run SWEny" step, change:
```yaml
github-token: ${{ github.token }}
```
to:
```yaml
github-token: ${{ secrets.GH_PAT }}
```

That is the only change needed in this file.

## Also add a comment

Add a YAML comment above the `github-token` line explaining why a PAT is required:
```yaml
# PAT required — github.token PRs are authored by github-actions[bot] which
# GitHub blocks from triggering pull_request CI events.
github-token: ${{ secrets.GH_PAT }}
```

## Verification

1. Read the current file first to understand the full context.
2. Make the single-line change described above.
3. Run `git diff` to confirm only the expected line changed.
4. Commit with message: `fix(ci): use PAT for sweny action so fix PRs trigger CI`

No tests to run. No build steps. Just the YAML edit and commit.

## Context

- Repo: `/Users/nate/src/swenyai/sweny`
- The `GH_PAT` secret must be added manually by the repo owner in GitHub Settings →
  Secrets. This task only updates the workflow file; the secret creation is out of scope.
- The PAT needs scopes: `repo`, `workflow`.
