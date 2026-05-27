# Task 05 — Re-publish once NPM_TOKEN is rotated (BLOCKED on the repo owner)

**Status: BLOCKED.** This cannot be completed by the agent. It requires rotating a secret only the repo owner / npm org member can create. Left as `.todo.md` on purpose.

**Context:** `@sweny-ai/core` is stuck at `0.1.102` on npm because the Release workflow's `npm publish` fails with `E404` (expired/invalid `NPM_TOKEN`). Versions never published include the multi-model release. Tasks 02-03 make future failures loud and stop a publish failure from freezing the `v5` action tag, but they do not fix the credential.

## What the repo owner must do
1. On npmjs.com, as a member of the `@sweny-ai` org with publish rights, create a new **Automation** access token (granular, scoped to `@sweny-ai`, read+write).
2. Set it as the repo secret:
   ```
   gh secret set NPM_TOKEN
   ```
   (paste the token at the prompt)
3. Re-run the failed release (or wait for the next merge):
   ```
   gh run rerun 26533044938     # the merge-of-#208 Release run
   ```
   The workflow's `max(local, npm)+1` bump logic publishes the correct next version and (after Task 03) advances the `v5` tag.

## Acceptance (for whoever unblocks it)
- `npm view @sweny-ai/core version` returns a version `> 0.1.102`.
- The Release workflow run is green.
- `git ls-remote --tags origin v5` advanced past the 2026-05-12 commit.
