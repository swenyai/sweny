# Task 55: Triage Quality — Rules/Context, Implement Path, and toolCalls Tracking

## Background

We're iterating on the CLI locally against Offload's permit-service data and providers (BetterStack, Linear, GitHub) in a fast loop. The MCP servers work locally with OAuth. Everything must also work in a GitHub Action (where OAuth may not be available — MCP servers need to work without it, or we fall back to REST skill tools).

### What's already done (this session, uncommitted)

- **OAuth priority fix** in `packages/core/src/claude.ts`: `buildEnv()` strips `ANTHROPIC_API_KEY` when `CLAUDE_CODE_OAUTH_TOKEN` is present — prevents `.env` files from poisoning auth
- **`allowDangerouslySkipPermissions: true`** + `stderr` callback added to both `query()` calls
- **Skip node +1 behavior** updated in `packages/core/src/workflows/triage.ts` — when triage detects a duplicate, the `skip` node posts "+1 — SWEny triage confirmed this issue is still active — seen again at {timestamp}"
- **Implement path** added to triage workflow (`implement` → `create_pr` nodes + routing edges) — WRITTEN but NOT built/tested
- **Provider context injection** wired into CLI (`packages/core/src/cli/main.ts`) and Action (`packages/action/src/main.ts`)
- **`buildAutoMcpServers()`** wired into CLI for MCP auto-injection

### Uncommitted files

- `packages/core/src/claude.ts`
- `packages/core/src/cli/main.ts`
- `packages/core/src/index.ts`
- `packages/core/src/mcp.ts`
- `packages/core/src/workflows/triage.ts`
- `packages/action/src/main.ts`
- `packages/action/tests/main.test.ts`

---

## Item 1: Rules & Context Config

### Problem

Teams have SDLC docs, RCA templates, coding standards etc. that should shape how SWEny works. Task 54 implemented `additional-context` as a flat list. We're evolving this into a semantic split.

### Design

Split `additional-context` into two fields in `.sweny.yml`:

```yaml
rules:
  - https://linear.app/letsoffload/document/offload-engineering-sdlc-568c6dfddf85
  - ./standards/rca-template.md
  - "Always reference the Linear issue ID in PR titles"

context:
  - https://linear.app/letsoffload/document/architecture-overview
  - ./docs/service-map.md
  - "permit-service is a Python FastAPI app using OCR + LLM extraction"
```

Each entry is one of:
- **URL** (starts with `http`) — fetched at runtime (by the `prepare` node via MCP tools or `loadTemplate()`)
- **File path** (starts with `.` or `/`) — read from disk at startup
- **Inline text** — everything else, used as-is

**`rules:`** = prescriptive. Injected as "You MUST follow these standards:"
**`context:`** = informational. Injected as "Background information:"

### Executor injection changes

Currently in `executor.ts` line 77-82, `additionalContext` is a single string prepended as `## Additional Context & Rules`. Change to accept structured input:

```typescript
// In the workflow input object:
interface WorkflowInput {
  rules?: string;      // Resolved rules text
  context?: string;    // Resolved context text
  additionalContext?: string; // Legacy — still supported
  // ... other input fields
}
```

Executor prepends to each node's instruction:
```
## Rules — You MUST Follow These

<rules text>

## Background Context

<context text>

---

<node instruction>
```

### Adding a `prepare` node to triage workflow

Add a `prepare` node as the new entry point (before `gather`):

```typescript
prepare: {
  name: "Load Rules & Context",
  instruction: `Fetch and review the knowledge documents listed in context.rules_urls and context.context_urls.
For each URL, use the appropriate tool to fetch its content (Linear MCP for Linear docs, web fetch for HTTP URLs).
Summarize the key rules and context that downstream workflow nodes should follow.
Output the consolidated rules and context.`,
  skills: ["linear"],
},
```

Entry changes from `"gather"` to `"prepare"`. Edge: `prepare → gather`.

The `prepare` node handles URLs that need MCP auth (Linear docs). Local files and inline text are resolved at startup by the CLI/Action and passed directly.

### Implementation checklist

- [ ] Add `rules: string[]` and `context: string[]` to `CliConfig` in `packages/core/src/cli/config.ts`
- [ ] Parse `rules:` and `context:` from `.sweny.yml` in the YAML parsing section
- [ ] Add `--rules` and `--context` CLI flags (comma-separated or repeated)
- [ ] Update `loadAdditionalContext()` in `packages/core/src/templates.ts` to handle inline text (not just files/URLs)
- [ ] Update `packages/core/src/cli/main.ts` to resolve local files + inline text at startup, pass URLs through for the prepare node
- [ ] Update `executor.ts` to accept `rules` and `context` separately (keep `additionalContext` as legacy fallback)
- [ ] Add `prepare` node to `packages/core/src/workflows/triage.ts` with entry change
- [ ] Update `packages/action/src/main.ts` to support `rules` and `context` inputs
- [ ] Update `action.yml` to add `rules` and `context` inputs
- [ ] Create changeset for `@sweny-ai/core` (minor — new feature)

---

## Item 2: Triage → Implement Path (OFF-1020 didn't create a PR)

### Problem

The triage workflow previously only created issues — no implement or PR step. OFF-1020 was identified but no fix was attempted.

### Status

**Already written** in `packages/core/src/workflows/triage.ts` (uncommitted). Added:
- `implement` node — create branch, read code, make fix, run tests, commit
- `create_pr` node — push branch, create PR with issue reference
- Routing edges:
  - `create_issue → implement` when `fix_complexity` is simple/moderate, `fix_approach` exists, not `dryRun`
  - `create_issue → notify` when complex, no fix_approach, or dryRun
  - `skip → implement` when duplicate still open + fixable + not dryRun
  - `skip → notify` when complex, no fix, PR exists, dryRun, or low severity
  - `implement → create_pr` (always)
  - `create_pr → notify` (always)
- `fix_complexity` (enum: simple/moderate/complex) added to investigate output schema

### Implementation checklist

- [ ] Build the package: `cd packages/core && npm run build`
- [ ] Run existing tests: `cd packages/core && npx vitest run`
- [ ] Run action tests: `cd packages/action && npx vitest run`
- [ ] Test end-to-end with CLI against permit-service: `cd /Users/nate/src/offload/permit-service && npx sweny triage`
- [ ] Verify the workflow routes to `implement` for a fixable issue
- [ ] Verify a PR is created
- [ ] Verify the `notify` node mentions the PR

---

## Item 3: toolCalls Tracking

### Problem

`toolCalls: []` in every node result is misleading. All real tools (Linear, GitHub, BetterStack) are called via external MCP servers inside the Claude Code subprocess. The old `toolCalls` array only tracked `sweny-core` in-process MCP tools — which is dead code since all tools now go through external MCP.

### Decision

**Option C** (decided by user): Capture tool data from TWO sources in `packages/core/src/claude.ts`:

1. **`tool_progress` messages** — already streamed by the SDK. Have `tool_name` and `elapsed_time_seconds`. Strip MCP prefix (`mcp__github__create_pull_request` → `create_pull_request`).
2. **`assistant` messages** — SDK emits these as `SDKAssistantMessage` with `message: BetaMessage`. The `BetaMessage.content` array contains `tool_use` blocks with `name` and `input`.

### Implementation

In `claude.ts` `run()` method, update the stream handler:

```typescript
// Track tool calls from MCP tools called by Claude Code
const toolCalls: ToolCall[] = [];

for await (const message of stream) {
  if (message.type === "tool_progress") {
    // ... existing progress handling ...
  } else if (message.type === "assistant") {
    // Extract tool_use blocks from assistant messages
    const assistantMsg = message as any;
    if (assistantMsg.message?.content) {
      for (const block of assistantMsg.message.content) {
        if (block.type === "tool_use") {
          toolCalls.push({
            tool: stripMcpPrefix(block.name),
            input: block.input,
            output: undefined, // output comes in tool_result messages
          });
        }
      }
    }
  } else if (message.type === "result") {
    // ... existing result handling ...
  }
}
```

### Implementation checklist

- [ ] Update `ToolCall` type in `packages/core/src/types.ts` — make `output` optional
- [ ] Update stream handler in `claude.ts` `run()` to capture tool_use from `assistant` messages
- [ ] Strip MCP prefixes from tool names using existing `stripMcpPrefix()`
- [ ] Verify tool calls appear in node results during end-to-end test
- [ ] Update action test mocks if needed

---

## Testing Plan

All three items converge in a single end-to-end test:

1. Create a minimal RCA template in Linear (or use inline for initial test)
2. Update `/Users/nate/src/offload/permit-service/.sweny.yml` with:
   ```yaml
   rules:
     - https://linear.app/letsoffload/document/offload-engineering-sdlc-568c6dfddf85
     - "Use the RCA template format for all issues"
   context:
     - "permit-service is a Python FastAPI app using OCR + LLM extraction"
   ```
3. Run `npx sweny triage` from permit-service
4. Verify:
   - `prepare` node fetches the SDLC doc from Linear
   - `gather` node uses BetterStack + GitHub + Linear MCP tools
   - `investigate` node includes `fix_complexity` in output
   - Issue follows the RCA template / rules
   - For a fixable issue: `implement` → `create_pr` → `notify` path fires
   - `toolCalls` are populated in each node's result
   - The full pipeline runs without "Credit balance is too low" errors

## Key Files

| File | Package | What changes |
|------|---------|-------------|
| `src/cli/config.ts` | core | Add `rules`/`context` config fields |
| `src/templates.ts` | core | Inline text support in `loadAdditionalContext()` |
| `src/executor.ts` | core | Split `additionalContext` into `rules` + `context` framing |
| `src/workflows/triage.ts` | core | Add `prepare` node (entry point change) |
| `src/claude.ts` | core | toolCalls tracking from assistant messages |
| `src/types.ts` | core | `ToolCall.output` optional |
| `src/cli/main.ts` | core | Wire rules/context through |
| `src/index.ts` | core | Export new types if needed |
| `src/main.ts` | action | Wire rules/context inputs |
| `action.yml` | action | Add rules/context inputs |
| `tests/main.test.ts` | action | Update mocks |

## Env Requirements (for local testing)

```bash
CLAUDE_CODE_OAUTH_TOKEN=...  # OAuth — NOT API key
GITHUB_TOKEN=...
LINEAR_API_KEY=...
BETTERSTACK_API_TOKEN=...
```

Do NOT set `ANTHROPIC_API_KEY` — `buildEnv()` strips it when OAuth is present, but cleaner to not have it at all.
