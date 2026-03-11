# @sweny-ai/cli

## 0.3.0

### Minor Changes

- 474589e: Add `--review-mode` flag to `sweny implement`.
  - `--review-mode auto` enables GitHub auto-merge when CI passes (suppressed automatically for high-risk changes: migrations, auth files, lockfiles, or >20 changed files)
  - `--review-mode review` (default) opens a PR and waits for human approval

### Patch Changes

- Updated dependencies [5053263]
- Updated dependencies [474589e]
- Updated dependencies [6a71f2a]
- Updated dependencies [474589e]
  - @sweny-ai/providers@0.3.0
  - @sweny-ai/engine@1.0.0
