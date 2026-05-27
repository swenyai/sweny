# Task 02 — Alert on Release-workflow failure

**Context:** The Release workflow failed silently for 2 weeks. The only reason it was noticed was a human reading `gh run list`. There is no Slack/webhook secret in the repo (`gh secret list` shows only `CLAUDE_CODE_OAUTH_TOKEN`, `GH_PAT`, `GITHUB_TOKEN`, `NPM_TOKEN`), so the lowest-friction durable alert is a GitHub issue opened by the workflow itself via `gh` (no new secret required).

**This task:** Add a failure-alert step to the Release job in `.github/workflows/release.yml` that opens (or comments on an existing) GitHub issue when the job fails.

## Design
- Step runs `if: failure()` so it only fires on a failed run.
- Dedupe by **title search** (avoid depending on a label that may not exist): if an open issue titled "Release workflow failing" already exists, comment on it with the new run URL; otherwise create it.
- Use `GH_PAT` if present, else `github.token`.
- The job needs `issues: write` permission added to the `permissions:` block (currently only `contents: write`, `id-token: write`).
- Do not log secrets. The body should contain only the run URL, commit SHA, and a short cause hint.

## Sketch
```yaml
permissions:
  contents: write
  id-token: write
  issues: write
# ...
      - name: Alert on release failure
        if: failure()
        env:
          GH_TOKEN: ${{ secrets.GH_PAT || github.token }}
        run: |
          TITLE="Release workflow failing"
          RUN_URL="${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
          BODY="Release failed for commit ${{ github.sha }}. Run: $RUN_URL. Common cause: expired NPM_TOKEN (npm publish returns E404 on a scoped package)."
          NUM=$(gh issue list --state open --search "in:title \"$TITLE\"" --json number --jq '.[0].number // empty')
          if [ -n "$NUM" ]; then gh issue comment "$NUM" --body "$BODY"; else gh issue create --title "$TITLE" --body "$BODY"; fi
```

## Acceptance
- `actionlint` (if available) / a YAML parse passes; the workflow still parses.
- The step is additive and only runs on failure, so it cannot break a green release.
- Lands with Task 03 in one PR against `main` (release-infra change; do not auto-merge).

## Verification
```
# YAML well-formed:
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml'))"
# optional, if installed:
actionlint .github/workflows/release.yml
```
