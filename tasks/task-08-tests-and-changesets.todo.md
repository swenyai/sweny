# Task 08: Final Test Pass + Changeset Verification

## Context

After all previous tasks, run the full test suite across all three packages, fix any
remaining issues, and verify all changeset files are present and correct.

Depends on: Tasks 01-07 complete.

## Steps

### 1. Full typecheck across all packages

```bash
cd packages/providers && npm run typecheck
cd packages/engine && npm run typecheck
cd packages/cli && npm run typecheck
```

Fix any remaining errors.

### 2. Full test run

```bash
cd packages/providers && npm test
cd packages/engine && npm test
cd packages/cli && npm test
```

Target: all tests green. Total should be ≥ 767 (may be higher after MCP adapter tests added).

### 3. Verify changeset files

Each published package that was changed must have a changeset. Expected:
```
.changeset/cleanup-mcp-poc.md                        (patch: providers)
.changeset/split-source-control-interfaces.md        (minor: providers)
.changeset/clean-issue-tracking-interfaces.md        (major: providers)
.changeset/update-triage-steps-renamed-interfaces.md (minor: engine)
.changeset/narrow-step-provider-types.md             (patch: engine)
.changeset/cli-factory-cleanup.md                    (patch: cli)
.changeset/mcp-adapters.md                           (minor: providers)
```

Run: `npx changeset status` to verify all are valid.

### 4. Verify no triage-specific names remain in provider interfaces

```bash
grep -rn "triage" packages/providers/src/  # should return 0 results
grep -rn "listTriageHistory\|TriageHistoryCapable\|TriageHistoryEntry\|searchByFingerprint\|FingerprintCapable" packages/providers/src/ packages/engine/src/ packages/cli/src/
# should return 0 results
```

### 5. Verify split interface exports

```typescript
// This should compile:
import type { GitProvider, RepoProvider, SourceControlProvider } from "@sweny-ai/providers/source-control";
import type { LabelHistoryCapable, IssueHistoryEntry, IssueTrackingProvider } from "@sweny-ai/providers/issue-tracking";
import { canSearchIssuesByLabel } from "@sweny-ai/providers/issue-tracking";
```

### 6. Rename all task files to `.done.md`

```bash
cd tasks/
for f in *.todo.md; do mv "$f" "${f%.todo.md}.done.md"; done
```

Also rename the plan:
```bash
mv task.refactor-providers.plan.todo.md task.refactor-providers.plan.done.md
```

## Final Commit Message
```
chore: verify all tests green, rename task files to done

All 8 refactor tasks complete:
- SourceControlProvider split into GitProvider + RepoProvider
- TriageHistoryCapable renamed to LabelHistoryCapable
- FingerprintCapable and searchByFingerprint removed (dead code)
- Issue.branchName is now optional
- MCP adapters added for Linear, Slack, GitHub (RepoProvider only)
- 767+ tests passing across providers, engine, cli packages
```
