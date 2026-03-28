# Task 61: Document rules, context, and templates configuration

## Goal
Document the knowledge injection system: `rules`, `context`, `issue-template`, and `pr-template`.

## Where to add
1. **New section in `workflows/index.md`** or **`workflows/custom.md`** — "Knowledge Injection" or "Customizing Workflow Behavior"
2. **`cli/commands.md`** — Document `--rules` and `--context` flags
3. **`action/inputs.md`** — Document `issue-template`, `pr-template`, `additional-context` inputs (may already be partially there — check and enhance)

## What to document

### Rules
- Provided via `rules` config key (CLI config file) or fetched from URLs
- Injected at the START of node instructions before the node's own instruction
- Use for: engineering standards, incident response protocols, coding guidelines
- Can be URLs (fetched at runtime), file paths, or inline text
- Example: `rules: ["https://company.com/standards.md", ".github/triage-rules.md"]`

### Context
- Provided via `context` config key
- Also injected into node instructions
- Use for: architecture docs, service documentation, deployment guides
- Same format as rules: URLs, file paths, or inline text

### Templates
- `issue-template` — Template for created issues (controls issue body format)
- `pr-template` — Template for created PRs (controls PR description format)
- Can be file paths or inline text

### How they combine
Check `packages/core/src/executor.ts` for the exact order:
1. Rules are prepended first
2. Context is prepended second
3. Then the node's base instruction
4. Legacy `additionalContext`/`additional-instructions` as fallback

## Verification
- Read `packages/core/src/executor.ts` to confirm instruction building order
- Read `packages/action/src/config.ts` to confirm input names
- Verify examples work with the actual config format
