---
"@sweny-ai/providers": minor
"@sweny-ai/engine": minor
---

Providers now expose `configSchema` — a declarative list of required env vars.
`runWorkflow()` runs pre-flight validation before step 1 and throws `WorkflowConfigError`
listing all missing env vars grouped by step. Built-in workflows now declare `uses` on each step.
