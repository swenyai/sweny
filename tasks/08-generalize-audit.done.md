# Generalize Audit Schema

## Context
The audit system in `packages/agent/src/audit/` has Slack-specific field names (`channelId`, `threadTs`) in the `AuditRecord` interface. These need to become platform-agnostic.

## Files to Modify

### `packages/agent/src/audit/types.ts`
Rename fields:
- `channelId: string` → `conversationId: string`
- `threadTs: string` → `messageId: string`
- Add new field: `channelName: string` (e.g., "slack", "cli", "discord")

### `packages/agent/src/audit/console.ts`
Update the log format string to use the new field names. Read the file first to see the current format.

### `packages/agent/src/slack/event-handler.ts`
Find where AuditRecord is constructed (look for `channelId` and `threadTs` assignments) and rename to `conversationId` and `messageId`. Add `channelName: "slack"`.

### Tests
Search for any test files that reference `channelId` or `threadTs` from the audit schema and update them.

## Verification
- `npm run typecheck --workspace=packages/agent` passes
- `npm test --workspace=packages/agent` passes (all 80 tests)
