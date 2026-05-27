# Task 02 — Execution-model resolution + executor threading

**Feature:** Multi-model cost tiering (issue #207). Depends on Task 01 (schema/types).
**This task:** Resolve the per-node model and thread it into the node execution call and the retry-reflection call.

## Why
Task 01 added the `model` field. Now the executor must resolve `node.model ?? workflow.model` and pass it to the AI invocation. The client default is applied one layer down (inside `ClaudeClient.run`, Task 03), so the full cascade is node → workflow → client default → Claude Code default.

## Background you need
- The executor's node-run call site is `claude.run({...})` in `packages/core/src/executor.ts`. Both `node` and `workflow` are in scope there.
- Reflection (autonomous retry) runs `claude.ask(...)` via `buildRetryPreamble` in `packages/core/src/retry.ts`. The reflection reasons about *this* node, so it should run on the node's model.
- Route selection (`claude.evaluate`) is a cross-node decision and deliberately stays on the client default. Do **not** thread per-node model there.
- The judge cascade lives in `eval/index.ts` (`resolveJudgeModel`, private). Mirror its shape but with NO package default: return `string | undefined`.

## Files
- `packages/core/src/model.ts` (new) — export `resolveExecutionModel(node, workflow): string | undefined` returning `node?.model ?? workflow?.model`.
- `packages/core/src/executor.ts` — import the resolver, compute `nodeModel` once per node, pass `model: nodeModel` to `claude.run` and to `buildRetryPreamble`.
- `packages/core/src/retry.ts` — add optional `model` to `BuildRetryPreambleOptions`, pass it to the `claude.ask` reflection call.

## Tests
- `packages/core/src/__tests__/model.test.ts` (new) — cascade: node wins; workflow when no node; undefined when neither; tolerates undefined args.
- `packages/core/src/__tests__/executor.test.ts` — a two-node workflow (workflow-level default + per-node override) asserts each node calls `run` with the expected resolved model; a plain workflow asserts `model` is `undefined`.

## Acceptance
- When nothing is set anywhere, `model` is `undefined` (so the client emits no SDK model option and Claude Code's default applies). No hardcoded execution default.
- Route `evaluate` is untouched.
- `npm run typecheck` + `npx vitest run` green.

## Verification
```
npm run typecheck --workspace=packages/core
cd packages/core && npx vitest run model executor
```
