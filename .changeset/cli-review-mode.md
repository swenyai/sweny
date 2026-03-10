---
"@sweny-ai/cli": minor
---

Add `--review-mode` flag to `sweny implement`.

- `--review-mode auto` enables GitHub auto-merge when CI passes (suppressed automatically for high-risk changes: migrations, auth files, lockfiles, or >20 changed files)
- `--review-mode review` (default) opens a PR and waits for human approval
