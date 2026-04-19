# Requires + Retry — Design Spec

**Status:** Approved
**Date:** 2026-04-19
**Owner:** nate
**Related:** verify v2 (shipped 2026-04-18, `@sweny-ai/core@0.1.74`)

---

## Goal

Add two node-level features to `@sweny-ai/core` that close the "good DX" gap left by verify v2:

1. **`requires`** — declarative pre-condition checks that run *before* the LLM, catching missing upstream context without burning tokens.
2. **`retry`** — node-local re-run on verify failure, with optional autonomous reflection so agents can self-heal from their own mistakes.

These features extend the existing post-condition story (`verify`) with a pre-condition story and a recovery story. Together they form the "machine-checked correctness" surface for workflow nodes.

## Non-Goals

- **Graph-level rollback retry** ("node 4 fails → re-run from node 2"). Already supported via `edge.max_iterations` with conditional back-edges. A future declarative shortcut could compile down to graph edges, but that is its own design.
- **Retry on non-verify failures.** Tool errors / API errors are not re-runnable in a useful way; retry is verify-specific by contract.
- **Retry on `requires` failure.** Pre-condition failure means upstream data is missing; re-running the same node will not materialize it.
- **Global cost ceiling on retries.** Workflow authors set `max: 2` or `max: 3`. The contract is honored as written.

---

## Architecture

Two new optional fields on `Node`:

```ts
interface Node {
  // existing
  name: string;
  instruction: Source;
  skills: string[];
  output?: JSONSchema;
  max_turns?: number;
  rules?: NodeSources;
  context?: NodeSources;
  verify?: NodeVerify;

  // new
  requires?: NodeRequires;
  retry?: NodeRetry;
}
```

Per-node lifecycle gains two new gates:

```
1. resolve instruction, rules, context, tools, skill instructions   (unchanged)
2. evaluateRequires(node.requires, contextMap)                      (NEW — pre-LLM gate)
3. claude.run(...)                                                  (unchanged)
4. evaluateVerify(node.verify, result)                              (unchanged)
5. retry loop (NEW) — if verify failed and node.retry set:
     build preamble (static / auto / reflect)
     claude.run(...) again
     re-evaluate verify
     repeat up to retry.max
6. results.set, trace.steps.push, observer node:exit                (unchanged + retry attempt)
```

`requires` reuses 100% of the verify path resolver (`resolvePath`, `checkOutputRequired`, `checkOutputMatches`) — it is a different data root and a different error prefix, nothing more.

`retry` adds one new method to the `Claude` interface (`ask`) for autonomous reflection mode.

---

## `requires` — Pre-Conditions

### Schema

```ts
interface NodeRequires {
  output_required?: string[];      // path must resolve, non-null/undefined
  output_matches?: OutputMatch[];  // path satisfies equals / in / matches
  on_fail?: "fail" | "skip";       // default: "fail"
}
```

Validation: at least one of `output_required` / `output_matches` must be declared (Zod `.refine()`, same pattern as `nodeVerifyZ`).

### Path Roots

Resolved against the cross-node context map:

```ts
{ input: <runtime input>, [priorNodeId]: <data of prior node>, ... }
```

So:
- `input.repoUrl` → field on runtime input
- `triage.recommendation` → `data.recommendation` of the prior `triage` node
- `any:findings[*].severity` → wildcard expansion (same grammar as verify)

### Failure Behavior

When `requires` fails, the node never invokes the LLM. The result is:

- `on_fail: "fail"` (default):
  ```ts
  { status: "failed", data: { error: "requires failed: ..." }, toolCalls: [] }
  ```
  Edge `when` conditions can route around it.

- `on_fail: "skip"`:
  ```ts
  { status: "skipped", data: { skipped_reason: "requires not met: ..." }, toolCalls: [] }
  ```
  Routing continues normally. Useful for optional branches like "only run notify-slack if `input.slack_channel` is set".

### Why no `*_tool_called` checks?

Tool calls are a property of the current node's execution, which has not happened yet. Out of scope.

### Example

```yaml
nodes:
  open_pr:
    name: Open PR
    instruction: Open a PR with the fix
    skills: [github]
    requires:
      output_required:
        - input.repoUrl
        - implement_fix.branch
      output_matches:
        - { path: implement_fix.filesChanged, matches: "^[1-9]" }
      on_fail: fail
    verify:
      any_tool_called: [github_create_pr]
      output_required: [prUrl]
```

---

## `retry` — Node-Local Self-Healing

### Schema

```ts
interface NodeRetry {
  max: number;  // 1+; total attempts = max + 1 (initial + retries)
  instruction?:
    | string                 // static preamble appended before retry
    | { auto: true }         // LLM generates retry strategy from failure context
    | { reflect: string };   // LLM generates strategy guided by author's prompt
}
```

Validation:
- `max` ≥ 1.
- Object form of `instruction`: exactly one of `auto: true` or `reflect: string`.

### Trigger

Verify failure only. Not requires failure, not LLM tool errors, not Claude API errors.

### Retry Loop

```
attempt = 0
while true:
  result = claude.run(node, withRetryPreamble?)
  if result.status != "success": break        # tool/API error — not a retry case
  verifyError = evaluateVerify(node.verify, result)
  if !verifyError: break                       # passed
  if attempt >= retry.max:
    result.status = "failed"
    result.data.error = verifyError
    break
  retryPreamble = await buildRetryPreamble(node, verifyError, result.toolCalls)
  attempt++
```

### Preamble Construction

| `instruction` value          | Preamble                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| (omitted)                    | `## Previous attempt failed verification\n{verifyError}\n\nFix the issue and try again.`  |
| `"static text"`              | `## Retry guidance\n{static text}\n\n## Previous attempt failed verification\n{verifyError}` |
| `{ auto: true }`             | LLM-generated diagnosis (default reflection prompt) + verify error                        |
| `{ reflect: "<prompt>" }`    | LLM-generated diagnosis (author's prompt) + verify error                                  |

The preamble is injected as a new section *prepended* to the node's normal instruction so the LLM sees it before the original task.

Each retry uses *only the latest* failure as preamble — not an accumulated history. The agent has the latest verify error; older ones are noise.

### New `Claude` Method

```ts
interface Claude {
  // existing
  run(opts: { instruction; context; tools; outputSchema?; onProgress?; maxTurns? }): Promise<NodeResult>;
  evaluate(opts: { question; context; choices }): Promise<string>;

  // new
  ask(opts: { instruction: string; context: Record<string, unknown> }): Promise<string>;
}
```

Single-completion, no tools, no output schema. Implementations bridge to whatever model client is in use.

**Reflection call failure handling:** if `claude.ask` throws or returns empty, fall back to the default static preamble for that attempt and log a warning. Reflection failure does not fail the workflow.

### Default Reflection Prompt (`{ auto: true }`)

```
You attempted to: {node.instruction}

Verification failed with: {verifyError}

You called these tools during the failed attempt:
{toolCallsSummary}

Briefly diagnose the failure and state your strategy for the retry.
Keep your response to 2-4 sentences.
```

### Example

```yaml
nodes:
  open_pr:
    name: Open PR
    instruction: Open a PR with the fix
    skills: [github]
    verify:
      any_tool_called: [github_create_pr]
      output_required: [prUrl]
    retry:
      max: 2
      instruction: { auto: true }
```

---

## Trace + Observer Changes

### TraceStep gains optional field

```ts
interface TraceStep {
  node: string;
  status: "success" | "failed" | "skipped";
  iteration: number;
  retryAttempt?: number;  // NEW — 0-indexed; only present when retries fired
}
```

Each retry attempt is its own step:

```
{ node: "fix", iteration: 1, status: "failed",  retryAttempt: 0 }
{ node: "fix", iteration: 1, status: "failed",  retryAttempt: 1 }
{ node: "fix", iteration: 1, status: "success", retryAttempt: 2 }
```

`iteration` continues to track node-run count from `nodeRunCounts` (driven by graph re-entry), unchanged.

### New Observer Event

```ts
type ExecutionEvent =
  // existing...
  | { type: "node:retry"; node: string; attempt: number; reason: string; preamble: string };
```

Fires before each retry attempt. The preamble is included so observers can surface the self-healing reasoning.

---

## Edge Cases (Locked)

- **Retry on non-verify failure:** does not fire. Retry is verify-specific.
- **Retry preamble accumulation:** only the latest failure is shown. Older errors are noise.
- **Reflection call failure:** fall back to default static preamble; log warning; do not fail workflow.
- **Trace last-result semantics:** `results.set(currentId, finalResult)` stores only the last attempt's result, matching current behavior for graph cycles. The trace preserves full attempt history.
- **Dry-run interaction:** the existing dry-run gate runs *after* node execution. Retry loop completes inside the node block before the dry-run check — no special handling.
- **Cost guard:** retry × autonomous reflection = up to `2 × max + 1` LLM calls per node. No global ceiling. Document.
- **`requires` on the entry node:** valid. Only `input.*` paths resolve; references to prior nodes always fail. No special handling.

---

## Surface Summary

**New types** (in `packages/core/src/types.ts`):
- `NodeRequires`
- `NodeRetry`
- Optional `Node.requires`, `Node.retry`
- Optional `TraceStep.retryAttempt`
- New `ExecutionEvent` variant `node:retry`
- New `Claude.ask` method

**New code** (in `packages/core/src/`):
- `requires.ts` — `evaluateRequires(requires, contextMap): string | null` (≈30 lines, wraps existing verify helpers)
- `retry.ts` — `buildRetryPreamble(node, verifyError, toolCalls, claude, logger): Promise<string>` (≈40 lines)
- `executor.ts` — pre-LLM `requires` gate, retry loop, `node:retry` observer event, `retryAttempt` on trace step

**New schema** (in `packages/core/src/schema.ts`):
- `nodeRequiresZ` (parallel to `nodeVerifyZ`)
- `nodeRetryZ` with tagged-union for `instruction`
- Extend `nodeZ` with optional `requires`, `retry`
- Extend `workflowJsonSchema` with both fields

**Spec docs** (in `spec/src/content/docs/nodes.mdx`):
- `## Requires` section with subsections + table of failure modes
- `## Retry` section with subsections + reflection-mode examples
- Update `Fields` table

---

## Testing Strategy

**Unit tests** (`packages/core/src/__tests__/`):
- `requires.test.ts` — mirrors `verify.test.ts` structure: path resolution against context map, on_fail modes, error message format, edge cases (missing prior node, null values, wildcard semantics).
- `retry.test.ts` — preamble construction (static, default, auto, reflect), `claude.ask` failure fallback, preamble injection into instruction.
- `schema.test.ts` extensions — Zod validation of `requires` (empty rejected, on_fail enum), `retry` (max ≥ 1, instruction tagged union exclusivity).

**Integration tests** (`packages/core/src/__tests__/executor.test.ts`):
- requires fail → node skipped LLM, status=failed, edge routing works
- requires fail with on_fail=skip → node status=skipped
- retry on verify failure → second attempt with preamble, succeeds
- retry exhaustion → status=failed, last verify error in data.error
- autonomous retry → claude.ask called with correct args, response becomes preamble
- reflection failure fallback → uses default preamble, warning logged
- trace records each attempt with retryAttempt
- observer receives node:retry events

**Cross-feature tests:**
- requires + retry on same node — requires runs first, retry only fires on verify
- requires fail + on_fail=skip + downstream node references skipped node — handled gracefully
- retry inside a graph cycle (max_iterations edge) — both bounds respected independently

Target: every public function in `requires.ts` and `retry.ts` has at least one passing and one failing test, plus integration coverage of the executor wiring.

---

## Backward Compatibility

Both fields are optional. Workflows with no `requires` / `retry` blocks behave identically. JSON schema additions are additive. No type-level breaking changes.

Patch bump is appropriate (`0.1.74` → `0.1.75`). Changeset will describe both features.

---

## Open Questions

None at this point. All scope locked through brainstorming on 2026-04-19.
