---
"@sweny-ai/core": minor
---

Per-node skill-tool filtering, fail-soft nodes, and Linear magic words in PRs.

New node fields (both additive and backward compatible; absent = previous
behavior):

- `tools: { allow?, deny? }` filters which skill-provided tools are exposed
  at a node. Filtered tools are never registered for the run, so the model
  cannot see or call them. Complements `disallowed_tools`, which covers
  built-in agent tools only.
- `fail_soft: true` downgrades an agent-level failure (max turns, early
  termination, SDK error) to success with `fail_soft: true` and the original
  `error` preserved in data, so the workflow proceeds with partial output.
  Eval failures are never softened.
- `ClaudeClient.run` now preserves the partial result text in `data.summary`
  when a query terminates early (e.g. `terminal_reason: max_turns`).

Triage workflow hardening (driving incident: a scheduled triage run whose
gather node created issues and PRs mid-gather and then died at the 50-turn
cap):

- `gather` is now structurally read-only: all issue/PR/comment write tools
  denied, `Write`/`Edit`/`NotebookEdit` disallowed, explicit scope boundary
  in the instruction, and `fail_soft: true` so a turn-cap death proceeds to
  `investigate` with partial context instead of failing the run.
- `investigate`, `create_issue`, `skip`, and `implement` get matching
  structural denies for the write tools their instructions already forbid.

Linear magic words:

- triage `create_pr`: PR body now includes `Fixes {issueIdentifier}` when
  the tracker is Linear (mirrors the existing Sentry line), so Linear links
  the PR and moves the issue to Done on merge.
- implement workflow: identifier-prefixed branch naming
  (`off-1234-fix-...`), identifier-bracketed commit messages and PR titles
  (`[OFF-1234] fix: ...`), and the same `Fixes` line in the PR body.
