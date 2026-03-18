---
"@sweny-ai/engine": patch
---

Clear stale fix-declined.md before each implement-fix run

A `fix-declined.md` left over from a prior triage run would cause the current
run's implement-fix step to be skipped even when the new agent succeeded. The
file is now deleted before the coding agent starts, so only a freshly-written
decline signals a skip.
