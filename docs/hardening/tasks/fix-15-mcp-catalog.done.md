# Fix #15: Unify MCP wiring into one catalog

_Part of HARDENING_PLAN.v1.claude.md (P4). Depends on nothing; unblocks Fix #18._

## Goal

Replace the two hand-maintained provider lists (`buildSkillMcpServers` and `buildAutoMcpServers`) with a single declarative catalog that both consumers project from. Removes ~180 lines of duplication and makes adding a provider a one-place edit.

## Why this matters

Today every provider appears twice in `packages/core/src/mcp.ts`:

- Once in `buildSkillMcpServers` (the modern skill-driven path used by `sweny workflow run`).
- Once in `buildAutoMcpServers` (the legacy flag-driven path used by `sweny triage` / `sweny implement`).

Adding or updating a provider requires editing both. Inevitably one will drift. Case in point: `asana` is in both builders but was dropped from `SUPPORTED_WORKSPACE_TOOLS`; `jira` uses `@sooperset/mcp-atlassian` (community, not first-party) which violates the `npx -y` exception documented in `ARCHITECTURE.md`.

## Current state (what you'll find)

- `packages/core/src/mcp.ts`:
  - `buildSkillMcpServers(opts: SkillMcpOptions): Record<string, McpServerConfig>` at ~line 39–204.
  - `buildAutoMcpServers(config: McpAutoConfig): Record<string, McpServerConfig>` at ~line 215–406.
  - Each has an if-chain per provider with nearly identical transport/auth/env logic.
- `packages/core/src/cli/config.ts:353` — `SUPPORTED_WORKSPACE_TOOLS = new Set(["slack", "notion", "pagerduty", "monday"])`. Note `asana` is absent.
- `packages/core/src/mcp.test.ts` — existing table-driven-ish tests; reuse for the new catalog.
- `ARCHITECTURE.md` — documents the `npx -y` exception for 6 official vendor packages.

## What to do

### Step 1 — extract the catalog

In `packages/core/src/mcp.ts` (or a new `packages/core/src/mcp-catalog.ts`), define a declarative array:

```ts
export interface McpCatalogEntry {
  /** Canonical server id (key in the returned record). */
  id: string;
  /** Which trigger paths wire this server. Most entries apply to both. */
  triggers: {
    skill?: string[];              // skill IDs that should wire this
    sourceControl?: string[];      // sourceControlProvider values
    issueTracker?: string[];       // issueTrackerProvider values
    observability?: string[];      // observabilityProviders entries
    workspaceTool?: string[];      // workspaceTools entries
  };
  /** How to wire it, given creds. Returns undefined if creds insufficient. */
  wire: (creds: Record<string, string>) => McpServerConfig | undefined;
  /** Transport hint for Fix #18. */
  transport: "http" | "stdio";
  /** For stdio servers, why npx -y is allowed (null forbids). */
  npxExceptionReason: string | null;
}
```

Populate `MCP_CATALOG: McpCatalogEntry[]` with one entry per provider currently in either builder: github, gitlab, linear, jira, datadog, sentry, newrelic, betterstack, slack, notion, pagerduty, monday, asana.

### Step 2 — rewrite the two builders as projections

- `buildSkillMcpServers(opts)` → iterate `MCP_CATALOG`, for each entry check if `opts.referencedSkills` intersects `entry.triggers.skill`, then try `entry.wire(creds)`. Merge `opts.skillMcpServers` (inline-skill MCPs) and `opts.userMcpServers` (user overrides) on top.
- `buildAutoMcpServers(config)` → iterate `MCP_CATALOG`, check each trigger type (sourceControl/issueTracker/observability/workspaceTool) against the entry. Same `wire` + same precedence.

Keep both function signatures identical to their current public shapes so callers don't change.

### Step 3 — rename internal `*Provider*` → `*Skill*` variables

While editing `mcp.ts`, rename local variables that use "Provider" language to match the product's "Skill" framing:

- `sourceControlProvider` parameter stays (public API) but internal catalog uses `triggers.sourceControl`.
- `observabilityProviders` parameter stays; internal iteration uses `triggers.observability`.
- Anywhere a comment or variable name says `*Provider*` purely internally, rename to `*Skill*`.
- Public `McpAutoConfig` interface in `types.ts` stays unchanged — **do not break the external API**.

### Step 4 — clean up drift

- `asana`: decide — either add to `SUPPORTED_WORKSPACE_TOOLS` (re-enable) or remove from the catalog (retire). Prefer retire; it's unused and the server is community-maintained. Document the choice in the commit message.
- `jira`: the server is `@sooperset/mcp-atlassian` (community). Options:
  - (a) Add an explicit exception: `npxExceptionReason: "Atlassian has no first-party MCP server; @sooperset/mcp-atlassian is the de-facto community standard."` Document this in `ARCHITECTURE.md`.
  - (b) Remove jira from the catalog until a first-party server exists.
  - Recommend (a) — Jira usage is real.

### Step 5 — tests

- `packages/core/src/mcp.test.ts` — replace per-provider if-tests with a table-driven spec over `MCP_CATALOG`:
  - For each entry, verify `wire` produces expected McpServerConfig given required creds, and `undefined` when creds missing.
  - Verify `buildSkillMcpServers` + `buildAutoMcpServers` produce correct outputs for a representative matrix of inputs.
- Add a test: every `stdio` entry with `command: "npx"` must have a non-null `npxExceptionReason`. Fails CI if a future entry violates.

## Acceptance criteria

- [ ] `MCP_CATALOG` is the single source of truth. `buildSkillMcpServers` and `buildAutoMcpServers` are <30 lines each.
- [ ] No provider wiring lives outside the catalog.
- [ ] `asana` resolved (re-enabled or removed) — state the choice in commit.
- [ ] `jira` either has explicit `npxExceptionReason` or is removed.
- [ ] `npm run typecheck --workspace=packages/core` passes.
- [ ] `npx vitest run --dir packages/core/src` passes including new/updated `mcp.test.ts`.
- [ ] No behavior change for users — the same inputs produce the same MCP server map.

## Rollout notes

- This is a refactor — wire compatibility is the acceptance bar.
- Before committing, run an end-to-end check: pick one sample workflow, inspect the MCP servers wired for both paths, diff against the behavior on `main`. They must match.

## Verify when done

```bash
cd packages/core
grep -c '"command":\s*"npx"' src/mcp.ts    # should show 0 (moved to catalog)
npm test
```
