# Task 03 — Decouple the v5 action tag from npm publish

**Context:** In `.github/workflows/release.yml` the whole pipeline is one job: build → test → `npm publish` (+ version bump + commit + `release-latest`/`release-*` bookkeeping tags) → move `v5` / cut `v5.<core_version>`. Because the `v5`-tag step runs **after** `npm publish` in the same job, a publish failure (e.g. bad `NPM_TOKEN`) prevents the `v5` moving tag from advancing, freezing every `swenyai/sweny@v5` consumer even though the action wrapper (`action.yml`, a composite action that installs `@sweny-ai/core@latest`) has nothing to do with the npm publish.

**This task:** Split so the `v5` action-pointer tags advance whenever build+test pass, even if `npm publish` fails. Keep the publish bookkeeping coupled to a successful publish.

## Critical correctness constraint
The `release-latest` / `release-*` tag is the **diff base** for change detection (`git describe --tags --match 'release-*'` → `DIFF_BASE`). It MUST advance only on a successful publish, or the next run computes diffs from the wrong base and skips publishing genuinely-changed packages. So:
- `release-latest` / `release-*` and the version-bump commit stay in the **publish** job (only on success).
- Only `v5` and the immutable `v5.<core_version>` move in the decoupled **tag** job.

## Design (3 jobs)
- `verify`: checkout + `npm ci` + build (core, studio:lib, mcp) + `npm run test`. Gate for the other two.
- `publish`: `needs: verify`. Checkout with `GH_PAT`, `npm ci`, build, the existing `bump_and_publish` + commit/push + `release-latest`/`release-*` tags. Keeps `NPM_TOKEN`. Carries the Task 02 failure alert.
- `tag-action`: `needs: [verify, publish]`, `if: ${{ !cancelled() && needs.verify.result == 'success' }}` (runs after publish regardless of publish success, skipped only if verify failed or the run was cancelled). Checks out the latest `main` (so it sees the publish bump commit when publish succeeded), then `git tag -f v5` + push, and the guarded `v5.<core_version>` create. Reads core version from `packages/core/package.json` (when publish failed it is unbumped, so `v5.<core_version>` already exists and the existing `if git tag ... 2>/dev/null` guard skips it).

## Notes / gotchas
- Avoid duplicating the build across `verify` and `publish` only if cheap; building twice is fine and simplest. Do not try to pass `dist/` between jobs via artifacts unless trivial.
- `concurrency: { group: release, cancel-in-progress: false }` stays at the workflow level.
- Preserve `permissions` per job (publish needs `contents: write`, `id-token: write`, `issues: write` for the alert; tag-action needs `contents: write`).
- `tag-action` must `fetch-depth: 0` and pull latest main before tagging so it does not move `v5` to a stale SHA.

## Acceptance
- Workflow parses; job graph is `verify → {publish, tag-action}` with `tag-action` depending on publish for ordering but not for success.
- A simulated publish failure (bad token) would still advance `v5` but NOT `release-latest` (reason it through in the PR description; cannot be unit-tested).
- Lands with Task 02 in one PR against `main`. Do NOT auto-merge: release-infra change that can only be fully validated on the next real release.

## Verification
```
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
actionlint .github/workflows/release.yml   # if installed
```
