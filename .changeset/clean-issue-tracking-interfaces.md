---
"@sweny-ai/providers": major
---

Rename triage-specific issue tracking interfaces to generic equivalents:
- `TriageHistoryCapable` → `LabelHistoryCapable`
- `TriageHistoryEntry` → `IssueHistoryEntry`
- `listTriageHistory()` → `searchIssuesByLabel()` (signature: `(projectId, labelId, opts?: { days? })`)
- `canListTriageHistory()` → `canSearchIssuesByLabel()`
- Remove `FingerprintCapable` interface and `canSearchByFingerprint()` (dead code — never called from engine)
- Make `Issue.branchName` optional (Linear returns real names; Jira/GitHub Issues synthesize them)
