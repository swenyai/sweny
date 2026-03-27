---
"@sweny-ai/core": minor
---

Add configurable templates, additional context, and fix skill validation + novelty gate

- **Configurable templates**: Issue and PR templates can be local files or URLs. Defaults to industry-standard formats. Configure via `.sweny.yml` (`issue-template`, `pr-template`) or action inputs.
- **Additional context**: Load SDLC docs, coding standards, or runbooks that get injected into every workflow node. Configure via `additional-context` (newline-separated file paths or URLs).
- **Skill validation fix**: No longer warns about every unconfigured skill. Only warns when a node has zero available skills from its list.
- **Novelty gate hardened**: `is_duplicate` is now required in investigate output. Searches both open AND closed issues. Edge conditions reference structured fields directly.
