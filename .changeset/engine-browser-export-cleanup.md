---
"@sweny-ai/engine": patch
"@sweny-ai/studio": patch
---

`WORKFLOW_YAML_SCHEMA_HEADER` is now exported from `@sweny-ai/engine/browser`
(the browser-safe entry). Studio's `export-yaml` now imports from the browser
entry, ensuring the export YAML path pulls zero Node.js transitive dependencies.
