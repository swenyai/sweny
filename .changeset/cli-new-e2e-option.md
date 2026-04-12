---
"@sweny-ai/core": minor
---

`sweny new` now offers "End-to-end browser testing" as a picker option —
selecting it delegates to the existing e2e wizard with `skipIntro: true` so
the two flows compose cleanly without double intros. `sweny e2e init` is
deprecated in favor of `sweny new`.
