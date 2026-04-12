---
"@sweny-ai/core": patch
---

`sweny new` is now idempotent — running it in a repo with an existing
`.sweny.yml` no longer prompts to overwrite. Existing config is preserved,
only the new workflow file is added (with per-file overwrite confirmation).
The `.env` append-only behavior already handled new keys correctly and
still runs for both fresh and existing repos.
