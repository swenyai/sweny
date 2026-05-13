---
"@sweny-ai/core": patch
---

`--verbose` improvements driven by a real debugging session where the
existing output was almost-but-not-quite enough.

1. Print `result.data` (the node's structured output) on `node:exit`.
   Without this, a node returning `{ status: "fail" }` despite every
   inspected tool call succeeding looks like a paradox. With it, you can
   see the node emitted the wrong field and root-cause the routing
   decision.
2. Raise the default truncation from 1200 to 4000 chars. A 14-item
   validation checklist JSON exceeds 1200 and the cut hides the bottom
   summary (`passed`/`failed` totals) which is the most actionable part.
3. New `SWENY_VERBOSE_TRUNCATE` env var for ad-hoc bumps without a code
   change.

Both kinds of tools (skill-registered AND Claude Code built-ins) remain
covered via `result.toolCalls` on `node:exit`.
