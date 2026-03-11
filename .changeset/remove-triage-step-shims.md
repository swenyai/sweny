---
"@sweny-ai/engine": patch
---

Remove dead re-export shims from triage/steps. The `create-pr`, `implement-fix`, and `notify` step files were one-line re-exports pointing to `nodes/` — no architectural purpose since nothing consumed them. Tests and the recipe index now import directly from `nodes/`.
