// ─── Execution model resolution ─────────────────────────────────────
//
// Mirrors the judge-model cascade in eval/index.ts, but for the model that
// executes a node (not the model that evaluates it). Unlike the judge
// resolver, there is NO package-level default: when no layer specifies a
// model, this returns undefined so the executor emits no SDK `model` option
// and Claude Code's own default applies.

import type { Node, Workflow } from "./types.js";

/**
 * Resolve the execution model for a node: `node.model ?? workflow.model`.
 *
 * Returns `undefined` when neither is set. The client default (if any) is
 * applied one layer down, inside `ClaudeClient.run` (`model ?? this.model`),
 * so the full three-layer cascade is node → workflow → client default →
 * Claude Code default. Callers SHOULD pass `undefined` through to `run`
 * rather than substituting a hardcoded model.
 */
export function resolveExecutionModel(node: Node | undefined, workflow: Workflow | undefined): string | undefined {
  return node?.model ?? workflow?.model;
}
