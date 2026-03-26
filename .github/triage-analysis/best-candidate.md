<!-- TRIAGE_FINGERPRINT
error_pattern: auto-changeset workflow creates duplicate PRs on every push to main
service: sweny-ci
first_seen: 2026-03-20
run_id: direct-run-2026-03-24
-->

RECOMMENDATION: implement

TARGET_SERVICE: sweny
TARGET_REPO: swenyai/sweny

**Issue Tracker Issue**: None found - New issue will be created

# Auto-Changeset Workflow Creates Stale PR Accumulation

## Summary

The `.github/workflows/auto-changeset.yml` workflow creates a new branch and PR on every push to main that touches published package source. It never closes previous auto-changeset PRs, causing unbounded PR accumulation. As of 2026-03-24, there are **7 stale PRs** (PRs #80-#86) with identical titles, all created within 4 days.

Each new auto-changeset PR supersedes the previous one because `scripts/auto-changeset.mjs` recalculates from the last release commit every time. Only the newest PR is relevant — all older ones are obsolete.

## Evidence

```
$ gh pr list --author "app/github-actions" --state open
#86  chore(changeset): auto-generated changeset  2026-03-22
#85  chore(changeset): auto-generated changeset  2026-03-21
#84  chore(changeset): auto-generated changeset  2026-03-21
#83  chore(changeset): auto-generated changeset  2026-03-20
#82  chore(changeset): auto-generated changeset  2026-03-20
#81  chore(changeset): auto-generated changeset  2026-03-20
#80  chore(changeset): auto-generated changeset  2026-03-20
```

Each uses a unique branch: `auto-changeset/<sha>`, guaranteeing a new PR every time.

## Root Cause

In `.github/workflows/auto-changeset.yml` (lines 51-67), the "Open PR with changeset" step:

1. Creates a branch named `auto-changeset/${{ github.sha }}` — unique per push
2. Commits and pushes the changeset file
3. Creates a new PR via `gh pr create`
4. **Never checks for or closes existing auto-changeset PRs**

```yaml
# Current (problematic):
- name: Open PR with changeset
  if: steps.changeset.outputs.created == 'true'
  run: |
    BRANCH="auto-changeset/${{ github.sha }}"
    # ... creates branch, commits, pushes, opens PR
    # MISSING: close old auto-changeset PRs
```

## Exact Code Changes

**File**: `.github/workflows/auto-changeset.yml`

Add a step before PR creation to close existing auto-changeset PRs and delete their branches:

```yaml
      - name: Close stale auto-changeset PRs
        if: steps.changeset.outputs.created == 'true'
        run: |
          # Find and close any existing auto-changeset PRs
          EXISTING=$(gh pr list --author "app/github-actions" --state open --json number,headRefName \
            --jq '.[] | select(.headRefName | startswith("auto-changeset/")) | .number')
          for PR_NUM in $EXISTING; do
            echo "Closing stale auto-changeset PR #$PR_NUM"
            gh pr close "$PR_NUM" --delete-branch --comment "Superseded by newer auto-changeset."
          done
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Open PR with changeset
        if: steps.changeset.outputs.created == 'true'
        run: |
          BRANCH="auto-changeset/${{ github.sha }}"
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git checkout -b "$BRANCH"
          git add .changeset/
          git commit -m "chore(changeset): auto-generate changeset for ${{ github.sha }}"
          git push origin "$BRANCH"
          gh pr create \
            --title "chore(changeset): auto-generated changeset" \
            --body "Auto-generated changeset for commits since last release. Review the bump level and description, then merge to include in the next release." \
            --base main \
            --head "$BRANCH"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Files to Modify

- `.github/workflows/auto-changeset.yml` — add "Close stale auto-changeset PRs" step before PR creation

## Impact

- **Without fix**: Every push to main touching published packages adds another orphan PR. At current velocity (~2 pushes/day), this creates ~60 stale PRs/month.
- **With fix**: Only the newest auto-changeset PR remains open. Stale PRs and their branches are cleaned up automatically.

## Test Plan

- [ ] Push a commit to main touching a published package source file
- [ ] Verify the workflow closes existing auto-changeset PRs (#80-#86) before creating a new one
- [ ] Verify the new PR is created successfully
- [ ] Verify deleted branches are cleaned up
- [ ] Push a second commit — verify only one auto-changeset PR exists after it runs

## Rollback Plan

Remove the "Close stale auto-changeset PRs" step from the workflow. The worst case of the fix is that it closes a PR someone was about to merge — but since these PRs are auto-generated and superseded by newer ones, this has no data loss risk. The changeset content is regenerated fresh each time.

## Confidence

Very high. The fix is additive (new step before existing step), uses standard `gh pr close`, and the `--delete-branch` flag cleanly removes obsolete branches. The workflow's existing concurrency group (`auto-changeset-${{ github.ref }}`) prevents races between simultaneous runs.

## Additional Observations

1. **LOCAL-2 still active**: The userId TypeError appeared 2 more times in the current log window. Recommend +1 on LOCAL-2.
2. **LOCAL-1 may be resolved**: `triageRecipe.nodes.length` pattern no longer exists in the codebase. Consider closing LOCAL-1 after verification.
3. **Dependabot PRs need rebase**: 9 open dependabot PRs are blocked by stale CI config. Rebasing on main will resolve.
