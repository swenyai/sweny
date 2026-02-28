# Task 17 — Tests for Action Phases (investigate, implement, notify, main)

## Objective

Add test coverage for the core 3-phase product loop in `packages/action`. These are the highest-value untested files — they orchestrate the entire autonomous SRE triage workflow.

## Project Context

- **Test framework**: Vitest v4 (all workspaces use `vitest run`)
- **Test style**: See `packages/action/tests/providers.test.ts` and `packages/providers/tests/observability.test.ts` for patterns
- **Mocking style**: `vi.fn()` mocks, mock `globalThis.fetch`, mock `@actions/core` via `vi.mock()`
- **All files are ESM** (`"type": "module"`, `.js` import extensions)

## Files Under Test

### 1. `packages/action/src/phases/investigate.ts` (469 lines)

**Exports**: `investigate(config, providers): Promise<InvestigationResult>`, `InvestigationResult` interface

**Key behaviors to test**:
- Calls `providers.codingAgent.install()` and `providers.observability.verifyAccess()`
- Calls `providers.issueTracker.verifyAccess()`
- Builds known issues context from `providers.issueTracker.listTriageHistory()` and `providers.sourceControl.listPullRequests()`
- Runs `providers.codingAgent.run()` with constructed prompt
- Parses results from `.github/datadog-analysis/best-candidate.md` file:
  - Extracts `RECOMMENDATION:` line → sets `recommendation`
  - Extracts `+1 existing ENG-XXX` → sets `existingIssue`
  - Extracts `TARGET_REPO:` → sets `targetRepo`
  - No best-candidate.md → `recommendation: "skip"`
  - No explicit RECOMMENDATION → defaults to `"implement"`
- Returns `InvestigationResult` with correct `shouldImplement` flag

**Mock strategy**: Mock `@actions/core`, all `providers` methods, and `fs` (for file read/write/existsSync).

### 2. `packages/action/src/phases/implement.ts` (545 lines)

**Exports**: `implement(config, providers, investigation): Promise<ImplementResult>`, `ImplementResult` interface

**Key behaviors to test**:
- **Skip gate**: Returns early with `skipReason` when recommendation is "skip"
- **+1 existing gate**: Adds comment to existing issue, returns with `skipReason`
- **Title extraction**: Reads heading from `best-candidate.md`, strips backticks and boilerplate, caps at 100 chars
- **Issue creation**: Searches Linear for existing issues, creates new if not found
- **Cross-repo dispatch**: When `targetRepo !== currentRepo`, dispatches workflow and returns
- **Existing PR check**: Finds existing PRs and skips if found
- **Branch creation**: Creates branch from issue identifier
- **Fix implementation**: Runs coding agent with implement prompt
- **Fix declined**: Returns early if `fix-declined.md` exists
- **Code changes check**: Creates fallback commit if uncommitted changes exist
- **PR creation**: Creates PR with generated description, links to Linear, updates issue state

**Mock strategy**: Mock `@actions/core`, all `providers` methods, `fs` (existsSync, readFileSync, mkdirSync).

### 3. `packages/action/src/phases/notify.ts` (72 lines)

**Exports**: `notify(config, providers, investigation, implementation?): Promise<void>`

**Key behaviors to test**:
- Builds summary with run date, service filter, time range, dry run status
- Includes Linear issue link when `implementation.issueIdentifier` exists
- Shows correct status messages: cross-repo dispatch, skip, +1 existing, success with PR, dry run
- Appends investigation log from `.github/datadog-analysis/investigation-log.md` if it exists
- Appends issues report from `.github/datadog-analysis/issues-report.md` if it exists
- Calls `providers.notification.send()` with title and markdown body

### 4. `packages/action/src/main.ts` (49 lines)

**Exports**: `run()` (called at module level)

**Key behaviors to test**:
- Calls `parseInputs()` and `createProviders()`
- Runs 3 phases in order: investigate → implement → notify
- Sets GitHub Action outputs: `issues-found`, `recommendation`, `issue-identifier`, `issue-url`, `pr-url`, `pr-number`
- Skips implement phase when `!findings.shouldImplement` or `config.dryRun`
- Calls `core.setFailed()` on error

## Test Files to Create

- `packages/action/tests/phases/investigate.test.ts`
- `packages/action/tests/phases/implement.test.ts`
- `packages/action/tests/phases/notify.test.ts`
- `packages/action/tests/main.test.ts`

## Key Interfaces (for mock construction)

```ts
// ActionConfig — from packages/action/src/config.ts
interface ActionConfig {
  anthropicApiKey: string; claudeOauthToken: string;
  observabilityProvider: string; ddApiKey: string; ddAppKey: string; ddSite: string;
  issueTrackerProvider: string; linearApiKey: string; linearTeamId: string;
  linearBugLabelId: string; linearTriageLabelId: string;
  linearStateBacklog: string; linearStateInProgress: string; linearStatePeerReview: string;
  timeRange: string; severityFocus: string; serviceFilter: string;
  investigationDepth: string; maxInvestigateTurns: number; maxImplementTurns: number;
  dryRun: boolean; noveltyMode: boolean; linearIssue: string;
  additionalInstructions: string; serviceMapPath: string;
  githubToken: string; botToken: string;
  repository: string; repositoryOwner: string;
}

// Providers — from packages/action/src/providers/index.ts
interface Providers {
  observability: ObservabilityProvider;
  issueTracker: ActionIssueTracker;  // IssueTrackingProvider & PrLinkCapable & TriageHistoryCapable
  sourceControl: SourceControlProvider;
  notification: NotificationProvider;
  codingAgent: CodingAgent;
}

// InvestigationResult
interface InvestigationResult {
  issuesFound: boolean; bestCandidate: boolean;
  recommendation: string; existingIssue: string;
  targetRepo: string; shouldImplement: boolean;
}

// ImplementResult
interface ImplementResult {
  issueIdentifier: string; issueUrl: string;
  prUrl: string; prNumber: number;
  skipped: boolean; skipReason?: string;
}
```

## Verification

1. `npm test --workspace=packages/action` — new tests pass
2. `npm test` — all tests pass (existing 343 + new)
