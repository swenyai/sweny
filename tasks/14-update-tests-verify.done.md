# Update Tests and Final Verification

## Context
Final task: ensure all tests pass, fix any broken imports, run full verification across the entire monorepo.

## Dependencies
- ALL previous tasks (07-13) must be complete

## Tasks

### 1. Fix broken imports
Search for any test or source file still importing from `../slack/` or `./slack/` and update to `../channel/` or `./channel/`.

```bash
grep -r "from.*['\"].*slack" packages/agent/src/ packages/agent/tests/
```

### 2. Update config schema tests
Read `packages/agent/tests/config/schema.test.ts`. Update any tests that:
- Validate Slack token formats (these are now optional)
- Reference old config structure

### 3. Update audit-related tests
Search for tests that reference `channelId` or `threadTs` and update to `conversationId` and `messageId`.

### 4. Run full test suite
```bash
# Agent tests (must pass all 80 existing + new tests)
cd /Users/nate.ross/src/wickdninja/sweny && npm test --workspace=packages/agent

# Provider tests (must still pass 211 tests — no regression)
npm test --workspace=packages/providers

# Action tests (must still pass 12 tests — no regression)
npm test --workspace=packages/action

# Full typecheck
npm run typecheck
```

### 5. Verify no slack/ references remain
```bash
grep -r "src/slack" packages/agent/src/
# Should return nothing
```

### 6. Verify exports
Check that `packages/agent/package.json` exports are correct and the channel types are accessible.

## Verification
- ALL tests across the monorepo pass
- Typecheck passes for all workspaces
- No references to the deleted `src/slack/` directory
- The Channel interface is exported from the agent package
