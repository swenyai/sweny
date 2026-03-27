---
"@sweny-ai/core": minor
---

Add `buildWorkflow()` and `refineWorkflow()` functions that generate and refine workflow definitions from natural language descriptions using the `Claude` interface (headless Claude Code). Replaces the previous direct Anthropic API implementation with the standard `Claude` abstraction, enabling proper testing via `MockClaude`.
