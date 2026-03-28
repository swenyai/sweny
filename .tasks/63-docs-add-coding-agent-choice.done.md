# Task 63: Document coding agent provider choice

## Goal
Document the `coding-agent-provider` option that lets users choose between Claude, Codex, and Gemini.

## Where to add
1. **`getting-started/faq.md`** — Update the "Which AI model does SWEny use?" answer
2. **`cli/commands.md`** — Document `--coding-agent-provider` / `--agent` flag
3. **`action/inputs.md`** — Document `coding-agent-provider` input (may already be there — check and enhance)
4. **`advanced/architecture.md`** — Brief mention in the agency layer section

## What to document
- Default is `claude` (headless Claude Code via `@anthropic-ai/claude-agent-sdk`)
- Alternative: `codex` (requires `OPENAI_API_KEY` / `openai-api-key` action input)
- Alternative: `gemini` (requires `GEMINI_API_KEY` / `gemini-api-key` action input)
- Claude is the recommended and most-tested option
- The choice affects the agent running INSIDE nodes — the orchestration layer (DAG executor) is the same regardless
- CLI flag: `--coding-agent-provider <provider>` or shorthand `--agent <provider>`

## Verification
- Check `packages/core/src/cli/main.ts` for the exact flag names and valid values
- Check `packages/core/src/claude.ts` or agent factory for how providers are resolved
- Make sure action inputs match CLI flags
