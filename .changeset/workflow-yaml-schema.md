---
"@sweny-ai/engine": patch
"@sweny-ai/cli": patch
"@sweny-ai/studio": patch
---

JSON Schema for workflow YAML updated and renamed to `workflow-definition.schema.json`.
Added the `type` field for built-in step types with known values as examples.
CLI `sweny workflow export` and Studio's Export YAML button now include a
`# yaml-language-server: $schema=...` header — VS Code auto-completes and
validates workflow YAML files with no extra setup.
