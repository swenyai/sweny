---
"@sweny-ai/cli": minor
---

Add `sweny workflow validate <file>` command. Validates a workflow YAML or JSON
file structurally (initial step exists, all transition targets are valid) and
exits 0 if valid, 1 with human-readable errors if not. Use `--json` for
machine-readable output suitable for CI pipelines.
