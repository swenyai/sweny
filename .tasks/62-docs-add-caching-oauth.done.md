# Task 62: Document step caching and OAuth token priority

## Goal
Document two undocumented features: step-level caching for crash recovery, and the OAuth token priority behavior.

## Where to add

### Step caching
Add to **`cli/commands.md`** under a new "Caching" subsection and mention in **`advanced/troubleshooting.md`**:
- `--cache-dir <path>` (default: `.sweny/cache`) — Directory for step result cache
- `--cache-ttl <seconds>` (default: `86400` = 24h, `0` = infinite) — Cache expiry
- `--no-cache` — Disable caching entirely
- How it works: Each completed node's result is cached by workflow ID + node ID + input hash. If a workflow crashes mid-execution and is restarted, previously completed nodes are loaded from cache instead of re-executed. This saves time and API costs.
- When to disable: When debugging or when input data has changed but the hash hasn't

### OAuth token priority
Add to **`cli/index.md`** (config priority section) and **`getting-started/quick-start.md`** and **`advanced/troubleshooting.md`**:
- `CLAUDE_CODE_OAUTH_TOKEN` takes precedence over `ANTHROPIC_API_KEY`
- If both are set (e.g., a `.env` file has `ANTHROPIC_API_KEY` but the action provides `CLAUDE_CODE_OAUTH_TOKEN`), the OAuth token wins
- This prevents local `.env` files from overriding CI-provided credentials
- In GitHub Actions, use `claude-oauth-token` input (which sets `CLAUDE_CODE_OAUTH_TOKEN`)

## Verification
- Check `packages/core/src/executor.ts` or `packages/core/src/cache.ts` for caching implementation
- Check `packages/core/src/claude.ts` for token priority logic
- Check `packages/action/src/config.ts` for how `claude-oauth-token` maps to env var
