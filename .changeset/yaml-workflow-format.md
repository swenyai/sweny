---
"@sweny-ai/engine": minor
"@sweny-ai/cli": minor
---

Add declarative YAML workflow support.

- New `StepDefinition.type` field for referencing built-in step implementations
- New `resolveWorkflow(definition)` — resolves a WorkflowDefinition to a runnable Workflow using the built-in step registry
- New `builtinStepRegistry` and `registerStepType` exports for extending the registry
- New `@sweny-ai/engine/builtin-steps` subpath — import to register all built-in step types
- New CLI command: `sweny workflow run <file.yaml>` — run any workflow from a YAML or JSON file
- New CLI command: `sweny workflow export triage|implement` — print built-in workflow as YAML for forking
