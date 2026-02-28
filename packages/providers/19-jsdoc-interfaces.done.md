# JSDoc: Add Documentation to All Provider Interfaces

Add JSDoc comments to all `types.ts` interface files and factory functions so consumers get IDE tooltips.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Task

Add JSDoc comments to the following files. Do NOT change any code logic - only add `/** */` documentation comments.

### 1. `src/observability/types.ts`

Add JSDoc to the interface and each field:

```ts
/** A single log entry returned from an observability provider. */
export interface LogEntry {
  /** ISO 8601 timestamp of the log entry. */
  timestamp: string;
  /** Service or application name that emitted the log. */
  service: string;
  /** Log severity level (e.g., "error", "warning", "info"). */
  level: string;
  /** Log message content. */
  message: string;
  /** Additional structured attributes from the log entry. */
  attributes: Record<string, unknown>;
}

/** Aggregated error count grouped by service. */
export interface AggregateResult { ... }

/** Options for querying logs from an observability provider. */
export interface LogQueryOptions {
  /** Relative time range (e.g., "1h", "24h", "7d"). */
  timeRange: string;
  /** Service name filter. Use "*" for all services. */
  serviceFilter: string;
  /** Log severity level to filter by (e.g., "error", "warning"). */
  severity: string;
}

/** Provider interface for querying logs and aggregating metrics from observability platforms. */
export interface ObservabilityProvider { ... }
```

### 2. `src/issue-tracking/types.ts`

Document all interfaces: Issue, IssueCreateOptions, IssueUpdateOptions, IssueSearchOptions, TriageHistoryEntry, IssueTrackingProvider, PrLinkCapable, FingerprintCapable, TriageHistoryCapable, and the type guard functions.

### 3. `src/incident/types.ts`

Document: Incident, IncidentCreateOptions, OnCallEntry, IncidentProvider.

### 4. `src/source-control/types.ts`

Document: PullRequest, PrCreateOptions, DispatchWorkflowOptions, PrListOptions, SourceControlProvider.

### 5. `src/messaging/types.ts`

Document: ChatMessage, MessagingProvider.

### 6. `src/notification/types.ts`

Document: NotificationPayload, NotificationProvider.

### 7. `src/storage/types.ts`

Document: PersistedSession, TranscriptEntry, SessionStore, MemoryEntry, UserMemory, MemoryStore, WorkspaceFile, WorkspaceManifest, WORKSPACE_LIMITS, WorkspaceStore, StorageProvider.

### 8. `src/credential-vault/types.ts`

Document: CredentialVaultProvider and each method.

### 9. `src/auth/types.ts`

Read this file first, then document all interfaces.

### 10. `src/access/types.ts`

Read this file first, then document all interfaces including AccessLevel enum and AccessGuard.

### Guidelines

- Keep JSDoc concise (1 line per field, 1-2 lines per interface)
- Use `@example` only on factory functions, not on interfaces
- Document parameters on interface methods: `@param` for each
- Document what the method returns: `@returns`
- Do NOT add JSDoc to private class methods - only to exported interfaces and factory functions

## Completion

1. Run `npx tsc --noEmit` to ensure no type errors introduced
2. Rename: `mv packages/providers/19-jsdoc-interfaces.todo.md packages/providers/19-jsdoc-interfaces.done.md`
3. Commit:
```
docs: add JSDoc documentation to all provider interfaces

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
