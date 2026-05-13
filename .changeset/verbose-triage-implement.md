---
"@sweny-ai/core": minor
---

`--verbose` now works on `sweny triage` and `sweny implement` in addition to
`sweny workflow run`. Same human-readable tool detail output, same observer,
same trade-offs (truncated to 4000 chars per side; use `--stream` for the
full untruncated NDJSON; `SWENY_VERBOSE_TRUNCATE` env var to bump the
truncation).

Motivation: PRs #194/#195/#196 wired verbose into the generic
`workflow run` command, but `sweny triage` and `sweny implement` go through
their own observer composition in `cli/main.ts` and didn't pick it up. The
swenyai/triage GitHub Action wraps `sweny triage`; without this change, a
triage run that halts or routes unexpectedly produces the same opaque log
that prompted the verbose work in the first place.

Tests: parseCliInputs gains three cases pinning the `verbose` field
plumbing (default false, true when set, defensive boolean coercion).
