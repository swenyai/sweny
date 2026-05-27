# Task 01 — Tracking issue for the silent release-pipeline failure

**Context:** The `Release` workflow (`.github/workflows/release.yml`) has failed on every push to `main` since ~2026-05-20 (last success 2026-05-18). Cause: `npm publish` returns `E404 PUT @sweny-ai/core ... Not Found`, which for an existing scoped package is npm masking a 401/403, i.e. the `NPM_TOKEN` repo secret is expired or lost publish rights to the `@sweny-ai` scope. Consequences:
- `@sweny-ai/core` stuck at `0.1.102` on npm (mcp `0.1.5`, studio `8.0.13`).
- The `v5` moving tag points at a 2026-05-12 commit, so `swenyai/sweny@v5` action consumers are ~2 weeks behind (the `v5`-tag step runs after `npm publish` in the same job, so it never executes when publish fails).
- It failed silently for 2 weeks because nothing alerts on Release failure.

**This task:** Open a GitHub issue that records the incident and the follow-up so it is tracked and visible.

## Steps
- `gh issue create` on `swenyai/sweny` titled something like "Release pipeline silently failing since 2026-05-18 (npm publish E404)".
- Body must include: root cause (expired/invalid `NPM_TOKEN`), evidence (failed run IDs, `gh run list --workflow=Release`), blast radius (npm versions frozen + `v5` tag stale since 05-12), the immediate fix (rotate `NPM_TOKEN`, re-run the failed release), and the durable fixes tracked in Tasks 02-03 (failure alerting + decoupling the `v5` tag from publish).
- Apply labels that exist in the repo (e.g. `bug`). Do not invent labels that block creation.

## Acceptance
- Issue exists with the above content; URL recorded in this file's `.done.md` version.
- No code change in this task.

## Result

Created: https://github.com/swenyai/sweny/issues/209
