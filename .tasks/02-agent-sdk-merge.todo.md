# Task 02: Merge feat/migrate-claude-agent-sdk

## Context

Branch `feat/migrate-claude-agent-sdk` is clean, 2 commits ahead of main, all tests passing.

**What the branch adds:**
- Swaps `@anthropic-ai/claude-code` (v1, had programmatic SDK) → `@anthropic-ai/claude-agent-sdk` (v0.2, dedicated in-process SDK) in `@sweny-ai/agent`
- Renames `customSystemPrompt` → `systemPrompt` in agent options (breaking change in agent package)
- Adds `coding-agent-provider: claude|codex|gemini` input to GitHub Action
- Adds file observability provider (`@sweny-ai/providers/observability` — new `file()` export)

**Why Anthropic split the packages:**
- `@anthropic-ai/claude-code` v2+ = CLI binary only (subprocess execution)
- `@anthropic-ai/claude-agent-sdk` = programmatic in-process MCP SDK

The providers layer (which spawns the CLI binary as a subprocess) is NOT affected.

---

## Steps

### 1. Merge the branch

```bash
cd /Users/nate/src/swenyai/sweny
git checkout main
git merge feat/migrate-claude-agent-sdk --no-ff -m "feat: migrate to claude-agent-sdk, add multi-provider action + file observability"
```

### 2. Verify tests pass

```bash
npm test --workspace=packages/agent
npm test --workspace=packages/action
npm test --workspace=packages/providers
```

### 3. Check typecheck

```bash
npm run typecheck --workspace=packages/agent
npm run typecheck --workspace=packages/action
```

### 4. Create changeset

`.changeset/agent-sdk-migration.md`:

```md
---
"@sweny-ai/agent": minor
"@sweny-ai/action": minor
"@sweny-ai/providers": minor
---

Migrate `@sweny-ai/agent` to `@anthropic-ai/claude-agent-sdk` (Anthropic split the programmatic SDK from the CLI binary).

**Breaking in `@sweny-ai/agent`**: `customSystemPrompt` option renamed to `systemPrompt`.

**New in `@sweny-ai/action`**: `coding-agent-provider` input (`claude` | `codex` | `gemini`), `openai-api-key`, `gemini-api-key` inputs.

**New in `@sweny-ai/providers`**: File observability provider — use a local JSON log file as the observability source. Useful for CI exports and offline triage.
```

### 5. Commit

```bash
git add .changeset/agent-sdk-migration.md
git commit -m "chore: add changeset for agent SDK migration"
```

---

## Done Criteria

- [ ] Branch merged to main (no conflicts expected — linear history)
- [ ] `npm test` passes in agent, action, providers
- [ ] `npm run typecheck` passes in agent, action
- [ ] Changeset created with correct bump levels
