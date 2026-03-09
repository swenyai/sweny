# Task: Make continuous-improvement workflow fully autonomous

## Goal

The `continuous-improvement.yml` dog-fooding loop currently creates PRs that sit waiting
for a human to merge. Enable autonomous mode: SWEny's fix PRs merge themselves once CI
passes.

This is independent of the engine task (01) — it only adds a YAML input line.
However, **auto-merge in GitHub requires two repo settings to be configured**:
1. "Allow auto-merge" must be enabled in the repo settings (Settings → General)
2. A branch protection rule must require at least one status check before merging

Both are already in place on `swenyai/sweny` (CI runs checks on PRs). This task
just flips the action input.

---

## Step 1: Edit the workflow

**File: `/Users/nate/src/swenyai/sweny/.github/workflows/continuous-improvement.yml`**

In the "Run SWEny" step, add `review-mode: auto` after `novelty-mode`:

```yaml
      - name: Run SWEny
        uses: swenyai/sweny@v1
        with:
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

          observability-provider: file
          log-file-path: /tmp/ci-logs.json

          issue-tracker-provider: github-issues
          github-token: ${{ secrets.GH_PAT }}

          dry-run: ${{ inputs.dry-run || 'false' }}
          time-range: ${{ inputs.time-range || '7d' }}
          investigation-depth: ${{ inputs.investigation-depth || 'thorough' }}
          novelty-mode: "true"
          review-mode: auto        # ← add this line

          additional-instructions: |
            ...
```

That is the **only code change**. Read the current file to get the exact indentation right.

---

## Step 2: Add a note to the workflow

Above the `review-mode` line, add a YAML comment:
```yaml
          # Auto-merge: SWEny's fix PRs merge automatically once CI passes.
          # Requires "Allow auto-merge" enabled in repo settings + branch protection rules.
          review-mode: auto
```

---

## Step 3: Verify

Run:
```bash
cd /Users/nate/src/swenyai/sweny
# Validate YAML syntax
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/continuous-improvement.yml'))" && echo "YAML valid"
```

---

## Step 4: Commit

```
feat(ci): enable autonomous mode — SWEny fix PRs auto-merge when CI passes
```

Then rename `04-autonomous-ci-loop.todo.md` → `04-autonomous-ci-loop.done.md` and commit:
```
chore: mark task 04 done
```

---

## Context

- File: `/Users/nate/src/swenyai/sweny/.github/workflows/continuous-improvement.yml`
- The `review-mode` input will be read by the action once task 02 is deployed
- Until task 02 is deployed (action dist rebuilt + v1 tag updated), the input is silently
  ignored — no harm in committing this now
- `GH_PAT` is already wired as the github-token (done in a previous session)
