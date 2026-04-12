---
"@sweny-ai/core": minor
---

Add `sweny new` as the canonical workflow creation command. `sweny init` is
deprecated and will be removed in the next major — it currently prints a
warning and delegates to `sweny new`. Reason: `init` implies one-time
bootstrap, but the command creates a workflow and users will run it many
times over a repo's life.
