---
"@sweny-ai/engine": patch
---

Fix JSON schema for StateDefinition to include the `provider` field that was already present in the TypeScript type. The schema had `additionalProperties: false` but omitted `provider`, causing AJV to reject all built-in recipe definitions in schema validation tests.
