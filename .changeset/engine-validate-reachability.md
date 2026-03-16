---
"@sweny-ai/engine": minor
---

`validateWorkflow()` now detects unreachable steps (error code `UNREACHABLE_STEP`).
Steps with no execution path from `initial` are reported as validation errors,
helping catch dead code in workflow definitions early.
