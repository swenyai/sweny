# Refactor Plan: Provider Architecture → Capability Framework

## Why This Exists

The current `@sweny-ai/providers` package was designed **bottom-up from the triage recipe**.
As a result, provider interfaces contain triage-specific logic, the registry has no concept
of capability composition, and adding MCP servers as tool sources is impossible without
replacing providers entirely.

SWEny is intended as a **general-purpose recipe framework**, not a triage tool. The
provider layer needs to reflect that.

---

## What Is NOT Changing

These are sound and stay as-is:
- DAG runner (`packages/engine/src/runner-recipe.ts`)
- Recipe definition format (states, phases, routing)
- Step function signatures (`WorkflowContext<TConfig>`)
- `CodingAgent` interface (already clean)
- `NotificationProvider` interface (already clean)
- `ObservabilityProvider` interface (already clean — triage-specific only in recipe steps)
- Auth, access, storage, credential-vault providers
- The test framework setup (Vitest + ESM)

---

## Problems Being Fixed

### Problem 1: `SourceControlProvider` mixes two concerns
`github.ts` does both local git shell operations AND GitHub API calls under one interface.
An MCP server, a cloud worker, or any non-local context cannot implement the git half.

**Fix:** Split into `GitProvider` (local shell) and `RepoProvider` (remote API).
Keep `SourceControlProvider = GitProvider & RepoProvider` as a convenience alias.

### Problem 2: Triage-specific names on generic interfaces; dead code

**How dedup actually works** (verified by reading all steps):
- `build-context` calls `listTriageHistory()` → builds a markdown list of recent known issues
- `investigate` passes that list to Claude in the prompt → Claude decides if novel (semantic dedup)
- `novelty-gate` reads Claude's `+1 existing` or `implement` recommendation
- `create-issue` calls `searchIssues()` by title as a fallback safety net

`listTriageHistory()` IS used and serves a real purpose. The problem is only the name —
"triage" in a generic provider interface.

`FingerprintCapable.searchByFingerprint()` — implemented in linear.ts and jira.ts, exported,
documented — but **NEVER CALLED from any recipe step**. Pure dead code.

**Fix:**
- Rename `TriageHistoryCapable` → `LabelHistoryCapable`
- Rename `listTriageHistory(projectId, labelId, days?)` → `searchIssuesByLabel(projectId, labelId, { days? })`
- Rename `TriageHistoryEntry` → `IssueHistoryEntry`, drop `fingerprint` field (null in Jira, unused everywhere)
- Remove `FingerprintCapable` and `searchByFingerprint` from all provider implementations
- Update the one call site in `build-context.ts` to use the new name

### Problem 3: `Issue.branchName` is a Linear concept faked everywhere
Linear returns a real branch name from the API. Jira and GitHub Issues derive `fix/${key}`.
If `branchName` is missing, recipe steps use it to create git branches — which creates
inconsistent behavior across trackers.

**Fix:** Make `branchName` optional on `Issue`. Steps that need a branch name derive it
deterministically from `identifier` if not provided.

### Problem 4: `stateId` semantics differ per provider (undocumented)
- Linear: UUID string (e.g., `"abc-123-def"`)
- Jira: status name that gets looked up via transitions API (e.g., `"In Progress"`)
- GitHub Issues: literal `"open"` or `"closed"`

Same field name, three different meanings. No documentation warns callers.

**Fix:** Document clearly in types. No behavior change needed — the abstraction is
intentionally leaky here and callers pass provider-specific values from config.

### Problem 5: No path to support MCP servers as capability sources
Currently `ProviderRegistry` is a typed string→unknown Map. There is no mechanism to
say "use the Linear MCP server for issue operations" alongside native providers.

**Fix:** Add `MCPCapabilitySource` that wraps `MCPClient` and maps MCP tool names to
provider interface methods. The registry remains the same — MCP sources just produce
objects that satisfy the same interfaces. No new registry API needed.

---

## Assumptions (verified against codebase)

✅ `listTriageHistory` is called ONLY in `triage/steps/build-context.ts`
✅ `searchByFingerprint` is NEVER called in any engine step — dead code (implemented, exported, but never used)
✅ Dedup is: listTriageHistory → Claude semantic matching → searchIssues title fallback
✅ `listTriageHistory` concept is valid, only the name needs changing
✅ `SourceControlProvider` is split across git ops + API in all 3 implementations
✅ `branchName` is faked in jira.ts (`fix/${key}`) and github-issues.ts (`fix/${number}`)
✅ `PrLinkCapable.linkPr()` IS generic — valid to keep
✅ DAG runner has no provider-specific knowledge — safe to leave untouched
✅ `WorkflowContext.providers` is the only injection point — no direct imports of providers in steps
✅ 767 tests currently passing — must finish green
✅ Cloud repo uses `@sweny-ai/providers` and `@sweny-ai/engine` — changeset required for each published-package change

---

## Architecture After Refactor

```
ProviderRegistry (unchanged Map interface)
├── "git"          → GitProvider           (local shell: branch, commit, push)
├── "repo"         → RepoProvider          (remote API: PR create, list, dispatch)
│   OR
├── "sourceControl"→ GitProvider & RepoProvider  (combined, for backward compat)
├── "issueTracker" → IssueTrackingProvider (create, get, update, search, comment, linkPr?)
├── "codingAgent"  → CodingAgent           (unchanged)
├── "notification" → NotificationProvider  (unchanged)
└── "observability"→ ObservabilityProvider (unchanged)

MCP Support:
├── MCPClient (packages/providers/src/mcp/client.ts) — spawns + calls MCP servers
├── MCPIssueTrackingAdapter — wraps MCPClient, satisfies IssueTrackingProvider
├── MCPRepoAdapter          — wraps MCPClient, satisfies RepoProvider
└── MCPNotificationAdapter  — wraps MCPClient, satisfies NotificationProvider
    (no MCPGitAdapter — local git ops cannot come from a remote MCP server)
```

Triage recipe utilities (in engine, not providers):
```
packages/engine/src/utils/issue-tracking.ts
├── queryTriageHistory(tracker, { projectId, labelId, days }) → TriageHistoryEntry[]
└── parseFingerprint(description) → string | null
```

---

## Task List

| # | File | Description |
|---|------|-------------|
| 01 | `task-01-cleanup-mcp-poc.todo.md` | Remove wrong-pattern MCP POC files, keep client.ts |
| 02 | `task-02-split-source-control.todo.md` | Split SourceControlProvider → GitProvider + RepoProvider |
| 03 | `task-03-clean-issue-tracking.todo.md` | Rename TriageHistoryCapable→LabelHistoryCapable; remove FingerprintCapable; fix branchName |
| 04 | `task-04-update-triage-steps.todo.md` | Update build-context to use renamed capability; remove fingerprint dead code |
| 05 | `task-05-update-shared-nodes.todo.md` | Update implement-fix + create-pr to use split interfaces |
| 06 | `task-06-update-shared-nodes.todo.md` | Update implement-fix + create-pr to use split interfaces |
| 07 | `task-07-update-implement-steps.todo.md` | Update implement verify-access + fetch-issue |
| 08 | `task-08-update-cli-factory.todo.md` | Update CLI provider factory for new interfaces/keys |
| 09 | `task-09-mcp-adapters.todo.md` | Build correct MCP adapters (satisfy interfaces, not replace them) |
| 10 | `task-10-tests-and-changesets.todo.md` | Fix all tests, create changesets for published packages |

---

## Execution Order

Tasks 01–03 are independent setup.
Task 04 depends on 03 (uses new Issue type).
Tasks 05–07 depend on 02, 03, 04.
Task 08 depends on 02, 03.
Task 09 depends on 02, 03 (adapters must satisfy new interfaces).
Task 10 runs after all others.

Commit checkpoint after each task completes.

---

## Definition of Done

- [ ] `npm run typecheck` passes in providers, engine, cli packages
- [ ] `npm test` passes in all three packages (767+ tests green)
- [ ] `SourceControlProvider` is split — git ops and repo ops are separate interfaces
- [ ] No provider interface method name contains "triage"
- [ ] `Issue.branchName` is optional
- [ ] `listTriageHistory` and `searchByFingerprint` do not exist on provider interfaces
- [ ] MCP adapters for issue-tracking, repo, and notification exist and satisfy interfaces
- [ ] Changeset files created for engine, providers, cli packages
- [ ] All task files renamed to `.done.md`
