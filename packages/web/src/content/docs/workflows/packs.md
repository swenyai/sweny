---
title: Recurring Workflow Packs
description: Three ready-made workflows you enable once and get value from every week - repo digest, dependency drift, PR risk review.
---

Most workflows get run once. These three are built to run again: a weekly digest, a weekly dependency check, and a risk note on every pull request. Each one is read-only except for one declared output, validates with no credentials, and ships a GitHub Action trigger with least-privilege permissions.

```bash
sweny new                                       # pick one (they follow "Explain this repo")
sweny new --template weekly-digest --yes        # or by id
sweny workflow validate .sweny/workflows/weekly-digest.yml   # no credentials needed
```

## Shared guarantees

- **Output schema on every node.** Each node declares the JSON shape it returns.
- **Gates before judges.** Every node has value or function gates (shape, enums, patterns, which tools were or were not called). A judge gate is used only where a rule cannot decide, and only once in the whole set.
- **Read-only by default.** Nodes that analyze have no write tools. The one delivery node lists exactly which write tools it may call with `tools.allow`.
- **Harness-agnostic.** Instructions use SWEny skill tools and plain read-only shell commands, no agent-specific tool names.
- **Bounded spend.** Every node sets `max_turns`.

Token ranges below are estimates from node count and turn caps. The run receipt at the end of every run shows the real number.

## `weekly-digest`

Every Monday: what changed this week, risky files touched, sent to an issue or Slack.

- **Runs:** Mondays 14:00 UTC (cron), or on demand
- **Reads:** Commits, merged pull requests, and issues through the `github` skill (`github_list_recent_commits`, `github_search_issues`), plus read-only `git log` in the checkout for churn.
- **Writes:** One issue per week (`github_create_issue`, label `sweny-digest`) or one Slack message (`slack_send_message`), chosen by the `deliver` input. Nothing else.
- **Permissions:** `contents: read`. Add `issues: write` only when `deliver` is `issue`.
- **Expected tokens:** 15k to 40k per run (estimate)

### Trigger

Save as `.github/workflows/sweny-weekly-digest.yml`:

```yaml
name: SWEny weekly digest
on:
  schedule:
    - cron: "0 14 * * 1" # Mondays 14:00 UTC
  workflow_dispatch:

permissions:
  contents: read
  issues: write # only needed for deliver: issue

jobs:
  digest:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/weekly-digest.yml
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          # input: '{"days": 7, "deliver": "slack"}'
        env:
          GITHUB_TOKEN: ${{ github.token }}
          # SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Gates

- `collect`: function gates (it queried the repo, it called no write tool) and value gates (dated window, commit shas match a sha pattern).
- `analyze`: value gates on the headline, counts, and risky-file categories. It calls no tool.
- `publish`: value gate on the destination, function gate that it never opens a PR or comments.

The run receipt and step summary show the DAG, duration, and tokens. The digest itself goes to the issue or Slack, because the step summary carries run metadata only.

### Sample output

Illustrative, not captured from a run.

```text
Weekly digest 2026-09-21 to 2026-09-28 (acme/api)

Auth middleware rewrite landed; 11 PRs merged, one touching the session store.

11 commits by 4 authors | 11 PRs merged | 6 issues opened | 9 closed

Merged
- #482 Rotate session secrets on deploy (@dana)
- #479 Cache permit lookups (@ravi)

Risky files
- src/auth/session.ts (auth): session secret handling changed, no test touched
- db/migrations/0041_add_index.sql (data): new index on a 40M-row table

Watch next week
- Add a test for session rotation (src/auth/session.ts)
```

## `dependency-drift`

Weekly: lockfiles plus open advisories, one deduped issue with what matters and why.

- **Runs:** Wednesdays 13:00 UTC (cron), or on demand
- **Reads:** Manifests and lockfiles in the checkout, and open Dependabot alerts through `github_list_dependabot_alerts`.
- **Writes:** At most one issue (`github_create_issue`, label `sweny-drift`), or one comment on the existing open one (`github_add_comment`). Never a PR, never a lockfile change.
- **Permissions:** `contents: read`, `issues: write`. Reading Dependabot alerts needs a fine-grained token with Dependabot alerts: read, because the built-in Actions token cannot. Without it the run still reports lockfile drift and says alerts were unavailable; it never guesses advisories.
- **Expected tokens:** 20k to 60k per run (estimate)

### Trigger

Save as `.github/workflows/sweny-dependency-drift.yml`:

```yaml
name: SWEny dependency drift
on:
  schedule:
    - cron: "0 13 * * 3" # Wednesdays 13:00 UTC
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  drift:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/dependency-drift.yml
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        env:
          # The built-in token cannot read Dependabot alerts. Use a fine-grained
          # token with Dependabot alerts: read, Issues: write, Contents: read.
          # Without it the run still reports lockfile drift and says alerts were unavailable.
          GITHUB_TOKEN: ${{ secrets.SWENY_GITHUB_TOKEN || github.token }}
```

### Gates

- `inventory`: value gate on ecosystem names, function gate that it wrote nothing.
- `advisories`: function gate that it asked for alerts, value gate that every alert has a severity and a GHSA or CVE id.
- `assess`: value gates on the action and severities. It calls no tool.
- `file-issue`: function gate that it searched for an existing issue before writing, no PR, value gate on the result.

Dedupe is by the open issue labelled `sweny-drift`: same advisories and paths means nothing is written.

### Sample output

Illustrative, not captured from a run.

```text
Dependency drift: 2 actionable

| Package | Severity | Advisory | Why it matters | Fix |
| --- | --- | --- | --- | --- |
| jsonwebtoken | high | GHSA-xxxx-xxxx-xxxx | Runtime dependency of the auth middleware | Upgrade to 9.0.0 |
| lodash | medium | GHSA-yyyy-yyyy-yyyy | Runtime dependency, reachable from the export route | Upgrade to 4.17.21 |

Drift
- services/worker/package.json: no lockfile, installs are unpinned

9 lower-severity or dev-only alerts deferred.
```

## `pr-risk-review`

On every pull request: read-only scope and risk review, one comment, no code writes.

- **Runs:** Every pull request opened, reopened, or marked ready (same-repo PRs)
- **Reads:** The PR title and description and the changed-file list with line counts (`github_get_issue`, `github_list_pr_files`). No patch bodies.
- **Writes:** One comment on the PR (`github_add_comment`). No code writes, no issues, no PRs.
- **Permissions:** `contents: read`, `pull-requests: write`. Fork PRs get a read-only token, so the job is skipped for them.
- **Expected tokens:** 10k to 30k per run (estimate)

### Trigger

Save as `.github/workflows/sweny-pr-risk-review.yml`:

```yaml
name: SWEny PR risk review
on:
  pull_request:
    types: [opened, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write # the review comment and the run billboard

concurrency:
  group: sweny-pr-risk-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  risk:
    # Fork PRs get a read-only token, so the comment cannot be posted there.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/pr-risk-review.yml
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          input: '{"repo": "${{ github.repository }}", "pr_number": ${{ github.event.pull_request.number }}}'
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

### Gates

- `scope`: function gates (it listed the files, it wrote nothing) and value gates on size and risky-area names.
- `assess`: value gates on the risk level and that every reason has evidence, and the pack's only judge gate: every reason must cite a path or fact from the measured scope.
- `post-comment`: function gate that the comment was posted, value gate on the result.

The Action's own sticky billboard (`pr-comment`, on by default) still posts the run receipt and DAG. The risk comment is separate and carries the findings. Only `opened`, `reopened`, and `ready_for_review` trigger it, so a busy PR does not collect a comment per push.

### Sample output

Illustrative, not captured from a run.

```text
Risk: high (size m, 6 files)

- src/auth/session.ts changed and no test file was touched
- db/migrations/0041_add_index.sql is a data migration

Where to look
- session secret handling in src/auth/session.ts
- whether 0041 needs a concurrent index build

Read-only scope review. No code was changed.
```

## Making them your own

Each pack is a plain workflow file in `.sweny/workflows/`. Change the inputs with the Action's `input` JSON (for example `{"days": 14, "deliver": "slack"}`), tighten a gate, or add a node. Keep the delivery node's `tools.allow` list in step with what you want it to write.
