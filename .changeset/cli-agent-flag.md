---
"@sweny-ai/cli": minor
---

Add `--agent <provider>` flag to `sweny triage` and `sweny implement`.

Supported values: `claude` (default), `codex`, `gemini`.
`--agent` takes priority over the longer `--coding-agent-provider` flag.
Also supported via `.sweny.yml`: `coding-agent-provider: codex`.
