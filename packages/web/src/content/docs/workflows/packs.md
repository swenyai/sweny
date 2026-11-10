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

`sweny new` also writes the pack's trigger to `.github/workflows/sweny-<pack>.yml` (the snippets below, verbatim). It never overwrites a file that exists, and `--no-ci` skips it. Add the `CLAUDE_CODE_OAUTH_TOKEN` repo secret, commit both files, and the pack runs on its own.

## Shared guarantees

- **Output schema on every node.** Each node declares the JSON shape it returns.
- **Gates before judges.** Every node has value or function gates (shape, enums, patterns, which tools were or were not called). A judge gate is used only where a rule cannot decide, and only once in the whole set.
- **Read-only by default.** Each pack declares a workflow `permissions` ceiling, and every analysis node runs `permissions: read`: no write tool, no file edits, and no shell (on Codex, a shell confined to its OS read-only sandbox: no writes, no network).
- **GitHub writes are safe outputs.** No node holds a GitHub write tool. The issue or comment a pack files is a declared output with a cap (and a pin, title prefix, and label where one applies); the agent requests it, and SWEny applies it after the step. `--stage` previews it without writing. See [Permissions and safe outputs](/workflows/yaml-reference/#permissions-and-safe-outputs).
- **Harness-agnostic.** Instructions use SWEny skill tools, no agent-specific tool names.
- **Bounded spend.** Every node sets `max_turns`.

Token ranges below are estimates from node count and turn caps. The run receipt at the end of every run shows the real number.

## `weekly-digest`

Every Monday: what changed this week, risky files touched, sent to an issue or Slack.

- **Runs:** Mondays 14:00 UTC (cron), or on demand
- **Reads:** Commits, merged pull requests, issues, and changed files through the `github` skill (`github_list_recent_commits`, `github_search_issues`, `github_list_pr_files` for churn).
- **Writes:** One issue per week (a safe output: at most one, title prefix `Weekly digest `, label `sweny-digest`) or one Slack message (`slack_send_message`, the only write tool `publish` holds), chosen by the `deliver` input. Nothing else.
- **Permissions:** `contents: read`, and `issues: write` for `deliver: issue` and the failure alert.
- **Quiet weeks:** with no commits, merged PRs, or issues opened or closed, nothing is delivered.
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
  issues: write # deliver: issue, and the failure alert

jobs:
  digest:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/weekly-digest.yml
          notify-on-failure: issue # one sticky issue, only when a run fails
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          input: '{"repo": "${{ github.repository }}"}'
          # input: '{"repo": "${{ github.repository }}", "days": 7, "deliver": "slack"}'
        env:
          GITHUB_TOKEN: ${{ github.token }}
          # SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Gates

- `collect`: function gates (it queried the repo, it called no write tool) and value gates (dated window, commit shas match a sha pattern).
- `analyze`: value gates on the headline, counts, and risky-file categories. It calls no tool.
- `publish`: value gate on the destination, function gate that it never writes to GitHub directly (the issue is a safe output).

A week with no activity routes to `quiet` and delivers nothing. SWEny decides that from the four counts with a deterministic [`when` expression](https://spec.sweny.ai/edges/#expressions) and no model call, so the digest does not train anyone to ignore it.

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
- **Writes:** At most one issue (a safe output: title prefix `Dependency drift: `, label `sweny-drift`), or one comment on the existing open one. At most one write per run. Never a PR, never a lockfile change.
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
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/dependency-drift.yml
          notify-on-failure: issue # one sticky issue, only when a run fails
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          input: '{"repo": "${{ github.repository }}"}'
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
- `file-issue`: function gate that it searched for an existing issue before requesting a write and never wrote to GitHub directly, value gate on the result.

Dedupe is by the open issue labelled `sweny-drift`: same advisories and paths means nothing is written. When `assess` finds nothing actionable (`action` is `none`), SWEny routes straight to `quiet` on a deterministic `when` expression and skips the issue step.

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
- **Reads:** The PR title and description and the changed-file list with line counts (`github_get_issue`, `github_list_pr_files`), then the patch hunks of the riskiest files: the risky areas first (CI/CD, auth, migrations, dependency manifests, secrets and config, public API), then the largest other changes (`github_get_pr_patches`). The tool caps the read at 8 files, 6000 bytes a file and 24000 bytes in all, and the comment names every file it left out or cut.
- **Writes:** One comment, pinned to the PR in `pr_number` (a safe output: a comment on any other issue or PR is refused). No code writes, no issues, no PRs.
- **Permissions:** `contents: read`, `pull-requests: write`. Fork PRs get a read-only token, so the job is skipped for them.
- **Expected tokens:** 15k to 50k per run (estimate)

### Trigger

Save as `.github/workflows/sweny-pr-risk-review.yml`:

```yaml
name: SWEny PR risk review
on:
  pull_request:
    types: [opened, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write # the one review comment, updated in place

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
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/pr-risk-review.yml
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          input: '{"repo": "${{ github.repository }}", "pr_number": ${{ github.event.pull_request.number }}}'
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

### Gates

- `scope`: function gates (it listed the files, it wrote nothing) and value gates on size and risky-area names. It lists the test files and risky-area paths it found, and SWEny recounts both lists: a count that disagrees gets one repair request.
- **The risk level is SWEny's, not the model's.** `assess` has three out-edges with `when` expressions over the scope measurements, evaluated with no model call. High: a risky area changed, and either no test was touched or the change is size l or xl. Medium: a risky area changed with tests, or no risky area but a source change of size m or larger with no tests. Low: everything else. Each level has its own comment node, pinned to that level by a value gate.
- `assess`: writes at most 4 notes, each a file, a hunk header, one quoted changed line, and an observation of at most 140 characters that only restates that line. Rule gates check the shape of every note (hunk header format, one-line quote, one-line observation within the cap) and that it read the hunks. The pack's only judge gate checks one thing: no observation says more than its quoted line (no consequences, no intent, no claimed bugs). A failed gate gets one retry with the gate's reasoning in front of the step; a second failure fails the run.
- `comment-high`, `comment-medium`, `comment-low`: function gate that the comment was requested, value gate that it carries the routed level. SWEny posts it after the step.

The review is one comment on the PR, updated in place on later runs: the findings plus one link to the run's receipt. Cost, tokens, duration and the DAG go to the Action's job summary, not the thread. A run whose findings match the last post writes nothing, and the job summary says so. See [PR comment](/action/inputs/#pr-comment).

By default, only `opened`, `reopened`, and `ready_for_review` trigger a review. A review describes the scope at the time it ran; later commits can make it stale.

To refresh the review when new commits are pushed, add `synchronize` to the event list in your generated `.github/workflows/sweny-pr-risk-review.yml`:

```yaml
on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize]
```

This starts a new model run for each push. New findings update the same comment; identical findings leave it untouched. Keep the existing concurrency group to cancel superseded runs and the same-repo guard to skip forks. Edit an installed trigger directly; this option does not require regenerating the pack.

### Sample output

Illustrative, not captured from a run.

```text
Risk: high (size m, 6 files, no test touched)
Areas: auth (src/auth/session.ts), data-migration (db/migrations/0041_add_index.sql), dependencies (package-lock.json)

- src/auth/session.ts @@ -40,6 +40,7 @@ `secure: false,`: Sets the secure option to false.
- db/migrations/0041_add_index.sql @@ -0,0 +1,3 @@ `CREATE INDEX idx_orders_user ON orders (user_id);`: Creates index idx_orders_user on orders.user_id.
Not read: package-lock.json (no patch from GitHub)
Read-only risk triage. No code was changed.
```

## Failure alerts

The two scheduled packs set `notify-on-failure: issue`. When a run fails or is refused, the Action opens one issue titled `SWEny run failed: <workflow>` labelled `sweny-failure`, and comments on it for later failures instead of opening more. Nothing is sent on success. It needs `issues: write`, which both triggers already request.

Setup failures are reported as `did_not_start`, even if the checkout contains successful history from an earlier run. Each Action invocation creates its own history marker before auth validation and dependency setup. If no valid marker is available, old history cannot suppress the alert. The notifier runs from the workspace so a missing workflow directory can still be reported.

For Slack, pass an incoming-webhook URL from a secret, or the name of an env var on the step that holds it:

```yaml
      - uses: swenyai/sweny@v5
        with:
          notify-on-failure: ${{ secrets.SLACK_FAILURE_WEBHOOK }}
```

The message carries metadata only: the workflow id, the failed node ids, a reason class (`node_failed`, `crashed`, or `did_not_start` for a run that was refused or never began), and the run link. No error text, node output, or model prose.

## Making them your own

Each pack is a plain workflow file in `.sweny/workflows/`. Change the inputs with the Action's `input` JSON (for example `{"days": 14, "deliver": "slack"}`), tighten a gate, or add a node. Change what a pack may write in its `outputs` and `safe_outputs` blocks, and keep the delivery node's `tools.allow` list in step with any non-GitHub write (Slack). Run with `--stage` to preview the writes first.
