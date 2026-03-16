---
"@sweny-ai/engine": patch
---

`WORKFLOW_YAML_SCHEMA_HEADER` is now defined in `@sweny-ai/engine/browser` (the
browser-safe entry) and re-exported from the main entry. This keeps the constant
at a single source of truth with zero Node.js transitive dependencies.
