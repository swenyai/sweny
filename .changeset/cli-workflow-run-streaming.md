---
"@sweny-ai/cli": minor
---

`sweny workflow run` now streams live step-by-step output to stderr as each step enters and exits, matching the experience of `sweny triage`. A new `--json` flag outputs the full result as JSON on stdout while suppressing progress output.
