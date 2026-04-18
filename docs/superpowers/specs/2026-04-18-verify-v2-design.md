# Verify v2 — Extensible Node Post-Conditions

**Status:** Draft
**Date:** 2026-04-18
**Owner:** nate

## Context

The workflow node spec already supports a `verify` block — a machine-checked post-condition the executor evaluates after the LLM finishes. Today it offers exactly one check, `any_tool_called`, which asserts that at least one of a named set of tools was invoked successfully during the node's execution. The check exists in `packages/core/src/{types.ts,schema.ts,executor.ts}` and is used by `packages/core/src/workflows/triage.yml` to catch the common "model claims success without doing the work" failure mode.

Two problems:

1. **One check isn't enough.** Real workflows want to assert "every named tool ran" (not just any), "this tool *didn't* run", and assertions against the node's structured output (e.g. "every finding has a valid severity"). Today the only escape is to add an entire workflow node, which is overkill.
2. **The current check isn't documented in the public spec.** The Astro spec site at `spec/src/content/docs/nodes.mdx` has no `verify` section. The schema, executor, and a real workflow all reference `any_tool_called`, but a workflow author reading the spec wouldn't know it exists.

This spec extends `verify` with a small, declarative set of additional checks and formalises the entire feature in the public spec.

## Goals

- Keep `verify` *declarative*. No mini-DSL, no expression language, no JS-in-YAML.
- Cover the obvious tool-call shape variants (`all`, `none`, in addition to `any`).
- Cover assertions against the node's structured output (`result.data`).
- Stay backwards-compatible — `any_tool_called` keeps its current shape and meaning.
- Document the feature end-to-end in `spec/src/content/docs/nodes.mdx`.

## Non-goals

- JSONPath / JMESPath / CEL / arbitrary expressions. Deferred.
- Conditional checks (`when:` on a verify entry) — overlaps with conditional edges.
- Cross-node verify (assert against an upstream node's result). Revisit if real demand emerges.
- Assertions on tool *inputs* ("`github_create_pr` was called with title matching X"). Adds a query layer; revisit later.
- `min_tool_calls`, `output_equals` — covered by other checks.
- Structured `verifyFailures: []` field on `NodeResult`. Deferred until Studio or cloud has a UI panel that would render it specially.

## Design

### Schema

```ts
export interface NodeVerify {
  /** ≥1 of these tools was called and succeeded. */
  any_tool_called?: string[];
  /** Every named tool was called and succeeded at least once. */
  all_tools_called?: string[];
  /** None of these tools may have been called. */
  no_tool_called?: string[];
  /** Listed paths must be present and non-null (see Path resolution). */
  output_required?: string[];
  /** Each assertion must hold against `result.data`. */
  output_matches?: OutputMatch[];
}

export interface OutputMatch {
  /** Dotted path; supports `[*]` wildcard; optional `all:`/`any:` prefix. */
  path: string;
  equals?: unknown;
  in?: unknown[];
  /** Regex source (no flags). */
  matches?: string;
}
```

Schema constraints (Zod):

- The existing refine ("verify must declare ≥1 check") expands to "≥1 of any of these fields".
- `OutputMatch` requires *exactly one* of `equals | in | matches` per entry.
- All string-array fields require `min(1)` length on the array (matches existing rule for `any_tool_called`).
- `path` is non-empty.

### Path grammar

A path is a `.`-separated sequence of segments. A segment is either:

- An identifier matching `[a-zA-Z_][a-zA-Z0-9_]*` — object property access, OR
- An identifier followed by `[*]` — wildcard expansion over an array.

Examples: `issueIdentifier`, `findings[*].severity`, `issues[*].metadata.url`.

A path may be prefixed with `all:` or `any:` to set wildcard semantics. The default when no prefix is given is `all:`.

The grammar is intentionally tiny so it can be parsed with ~30 lines of code, specified in one paragraph, and rendered cleanly in Studio. We can graduate to JSONPath later if real demand appears.

### Operators (`output_matches`)

Exactly one operator per `OutputMatch` entry. The operator runs against each value the path resolves to:

| Operator        | Meaning                                                        |
|-----------------|----------------------------------------------------------------|
| `equals: x`     | Strict deep equality (e.g. `lodash.isEqual`).                  |
| `in: [x, y, z]` | Value is in the array (deep equality per element).             |
| `matches: "re"` | Value is coerced to string and tested against the JS regex.    |

Future operators (`gt`, `lt`, `not_equals`, `not_in`) are deliberately out of scope for v1.

### Path resolution

A path is resolved by walking segments left-to-right against `result.data`:

- A non-wildcard segment that doesn't exist on the parent object → **resolution fails**. `output_required` and `output_matches` both treat a failed resolution as a failed check (with a clear error message naming the missing segment).
- A `[*]` segment requires the parent to be an array. If the parent isn't an array → resolution fails. If the parent is an array (even empty), expansion succeeds and the wildcard rule below applies.
- A `null` encountered mid-path → resolution fails.

### Wildcard semantics

When a path contains `[*]` and resolution succeeds:

- `all:` (default) — every resolved value satisfies the operator. Empty array → vacuously true.
- `any:` — at least one resolved value satisfies. Empty array → false.

`output_required` follows the same rule: `output_required: ["findings[*].severity"]` (default `all:`) means the `findings` array exists and every finding has a present, non-null `severity`. `output_required: ["any:findings[*].severity"]` means the `findings` array exists and at least one finding has a non-null `severity`.

### Combining checks

All checks declared on a node are AND-ed. Order doesn't matter. The node passes verify only if every declared check passes.

### Failure reporting

Executor runs all declared checks (no fast-fail). Failed checks are concatenated into a single error string set on `result.data.error`:

```
verify failed:
  - any_tool_called: required one of [linear_create_issue, github_create_issue], called: [linear_search_issues]
  - output_required: 'issueUrl' missing
  - output_matches: findings[*].severity not in [critical, high, medium, low] (got: [urgent])
```

`NodeResult` shape is unchanged. No new fields, no consumer changes in cloud worker, studio, MCP, or web.

### Tool-call success rule (unchanged)

A tool "was called and succeeded" if it appears in `result.toolCalls` with no `output.error`. The rule is shared by all three tool-call checks (`any_tool_called`, `all_tools_called`, `no_tool_called`). For `no_tool_called`, *any* appearance in `result.toolCalls` (success or failure) counts as a violation — the intent is "this tool must not have been invoked at all".

### Worked example

```yaml
verify:
  all_tools_called: [github_create_pr]
  no_tool_called:   [github_force_push]
  output_required:  [prUrl, branchName]
  output_matches:
    - { path: prUrl,                    matches: "^https://github.com/" }
    - { path: branchName,               matches: "^sweny/" }
    - { path: any:checks[*].conclusion, equals:  "success" }
```

### Spec representation

A new top-level **Verify** section in `spec/src/content/docs/nodes.mdx`:

1. *What verify is for.* Post-condition vs pre-condition. Complements (does not replace) conditional edges.
2. *Tool-call checks* — `any_tool_called`, `all_tools_called`, `no_tool_called` with one example each.
3. *Output checks* — `output_required`, `output_matches`, the path grammar, wildcard semantics, operator table.
4. *Combining checks & failure reporting.*
5. *Worked example* (the YAML block above).

## Backwards compatibility

`any_tool_called` keeps its current shape and semantics. `triage.yml` works unchanged. No migration needed for existing workflows.

## Implementation footprint

| File                                              | Change                                                                 |
|---------------------------------------------------|------------------------------------------------------------------------|
| `packages/core/src/types.ts`                      | Extend `NodeVerify`, add `OutputMatch` (~10 lines).                    |
| `packages/core/src/schema.ts`                     | Extend `nodeVerifyZ`, add `outputMatchZ`, refine logic (~40 lines).    |
| `packages/core/src/executor.ts`                   | Rewrite `evaluateVerify` (run-all + concat). Path resolver (~80 lines).|
| `packages/core/src/__tests__/schema.test.ts`      | Coverage per check (~80 lines).                                        |
| `packages/core/src/__tests__/executor.test.ts`    | Coverage per check + path/wildcard edge cases (~120 lines).            |
| `spec/src/content/docs/nodes.mdx`                 | New Verify section (~150 lines).                                       |
| Cloud worker, studio, MCP, web                    | No changes.                                                            |

## Open questions

None at this time. All design questions resolved during brainstorming (see decisions log below).

## Decisions log

- **Scope of verify:** Tool calls + structured output. Arbitrary expressions deferred.
- **Check inventory:** `any_tool_called`, `all_tools_called`, `no_tool_called`, `output_required`, `output_matches` (array form only).
- **Path grammar:** Dotted with `[*]` wildcard. No JSONPath.
- **Failure reporting:** Run all checks, concatenate into one error string. `NodeResult` shape unchanged.
- **Wildcard semantics:** Explicit `all:`/`any:` prefix, with `all:` as the implicit default. Removes ambiguity for readers without forcing verbosity in the common case.
- **`output_matches` operators (v1):** `equals`, `in`, `matches`. Negative and comparison operators deferred.
