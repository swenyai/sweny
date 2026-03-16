---
"@sweny-ai/engine": patch
"@sweny-ai/cli": patch
---

Add `listStepTypes()` to engine for introspecting the built-in step registry.
Add `sweny workflow list` CLI command to print all registered step types
(human-readable by default, `--json` for machine-readable output).
