---
"@sweny-ai/core": patch
---

Soften the implement-node verify gate added in 0.1.82 to avoid breaking
non-web-backend triage targets.

The previous version required `test_status: pass` AND `test_files_changed`
non-empty with no exceptions. That blocked every fix in repos without a
test framework — YAML/config-only repos, docs-only repos, research/notebook
repos, brand-new projects without test infra. The intent was "don't
silently skip tests when tests exist," not "ban fixes in test-less repos."

Now:
- `test_status: no-framework` clears verify (genuinely no runner in repo).
- The Quality Bar's framework idiom examples are stack-agnostic
  (NestJS / Go / TypeScript shown as illustrations rather than the only
  valid shapes).

The verify rule still blocks the original failure mode — a fix that
silently skipped tests in a repo that has them — by requiring
`test_files_changed` as a required output field with the schema and the
instruction text disallowing the obvious cheat (claiming `pass` with an
empty array). `not-run` and `fail` still retry once and then halt.
