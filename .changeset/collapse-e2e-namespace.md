---
"@sweny-ai/core": minor
---

Collapse the `sweny e2e` command namespace into the single entry points. `sweny new` is now the one door for workflow creation, and `sweny workflow run` is the one door for running.

- `sweny e2e init` → `sweny new e2e` (jumps straight into the e2e wizard; the interactive `sweny new` picker still offers it too).
- `sweny e2e run` → `sweny workflow run`. With no file argument, `sweny workflow run` now batch-runs every workflow in `.sweny/e2e/`, lists them, and asks for confirmation first. Pass `--yes` (`-y`) to skip the prompt in CI, and `--timeout <ms>` for the per-workflow batch timeout.

The public `swenyai/e2e` action is unaffected: it already invokes `sweny workflow run <file>` with an explicit file.
