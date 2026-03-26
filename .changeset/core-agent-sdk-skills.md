---
"@sweny-ai/core": minor
---

Use headless Claude Code (agent SDK) as LLM backend instead of raw Anthropic API.

- **Breaking**: `ClaudeClient` now uses `@anthropic-ai/claude-agent-sdk` (`query()` + `createSdkMcpServer()`) — no longer requires `ANTHROPIC_API_KEY`, uses `CLAUDE_CODE_OAUTH_TOKEN` via Claude Code
- **New**: Skill categories (`git`, `observability`, `tasks`, `notification`, `general`) on every skill
- **New**: `betterstack` skill — incidents, monitors, on-call via BetterStack Uptime API
- **New**: `validateWorkflowSkills()` — pre-execution validation that checks provider availability by category
- **New**: `isSkillConfigured()`, `configuredSkills()` helpers for env-based provider detection
- **Changed**: Triage workflow instructions are provider-agnostic; nodes list all compatible skills per category
- **Removed**: `@anthropic-ai/sdk` dependency
