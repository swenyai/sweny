---
"@sweny-ai/engine": patch
---

Add `"UNREACHABLE_STEP"` to the `WorkflowDefinitionError.code` union — this code was emitted by `validateWorkflow()` but missing from the type, causing a TypeScript error in consuming code.
