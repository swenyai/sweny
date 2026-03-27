---
"@sweny-ai/core": minor
---

Move CLI source into core as `src/cli/`, rewriting imports to use core's DAG executor and skill system instead of the old engine+providers. The CLI entry point (`npx @sweny-ai/core triage`) now uses `execute()` with `createSkillMap(configuredSkills())` and `ClaudeClient` instead of `runWorkflow()` with provider registries.
