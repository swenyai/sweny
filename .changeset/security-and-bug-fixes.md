---
"@sweny-ai/providers": patch
"@sweny-ai/engine": patch
"@sweny-ai/studio": patch
---

Fix multiple correctness and security issues found in code review

**@sweny-ai/providers**
- `file.ts`: Replace `execSync` string interpolation with `execFileSync` + args array,
  eliminating command injection risk from branch names, commit messages, and file paths
- `github.ts`, `gitlab.ts`: Escape `searchTerm` before use in `new RegExp()` to prevent
  incorrect matching or ReDoS on identifiers containing regex metacharacters
- `github-issues.ts`: Return issue `number` (not internal node `id`) from `createIssue`,
  `searchIssues`, and `getIssue` — all GitHub REST API endpoints that accept an issue
  reference expect the issue number, not the internal 9-digit node ID
- `linear.ts`: Fix multi-label filter to use `{ some: { id: { in: labels } } }` instead
  of `{ id: { eq: labels[0] } }` which silently dropped all but the first label
- `jira.ts`: Escape user-supplied values before embedding in JQL strings to prevent
  injection via `projectId`, `query`, `labels`, and `states` parameters

**@sweny-ai/engine**
- `implement-fix.ts`: Remove unreachable dead code — the `issueOverride` + non-open PR
  branch was nulled out before the check that used it; logic now correctly lets issue
  override bypass the duplicate-PR skip
- `risk-assessor.ts`: Fix lockfile/`package.json` patterns to match nested paths
  (e.g. `packages/engine/package.json`) — anchored `^...$` patterns only matched
  root-level files
- `cross-repo-check.ts`: Report `dispatched: false` when `dispatchWorkflow` throws
  instead of returning `{ dispatched: true }` on a failed dispatch

**@sweny-ai/studio**
- `WorkflowViewer.tsx`: Memoize `validateWorkflow` result via `useMemo` — was called
  4× per definition change (once per effect × two helper functions); now computed once
- `App.tsx`: Guard global keyboard shortcuts so they don't fire while the user is
  typing in an `<input>`, `<textarea>`, or `contentEditable` element
