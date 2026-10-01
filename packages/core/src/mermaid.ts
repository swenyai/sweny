/**
 * Mermaid diagram export
 *
 * Converts a Workflow into a Mermaid flowchart string.
 * Renders natively in GitHub (job summaries, READMEs, issues, PRs),
 * VS Code preview, documentation sites, and anywhere Mermaid is supported.
 *
 * Accepts optional execution state to color nodes by status
 * (current/success/failed/skipped) and optional execution trace
 * to highlight which edges were taken and show loop iterations.
 */

import type { Workflow, ExecutionTrace } from "./types.js";
import { whenLabel } from "./when.js";
import { MERMAID_CLASS_DEFS, MERMAID_EDGE_STYLES, type DiagramNodeStatus } from "./theme.js";

/**
 * A node's state in a diagram. `pending` is applied automatically to every
 * node missing from a non-empty `state` map (the run never reached it).
 */
export type NodeStatus = DiagramNodeStatus;

export interface MermaidOptions {
  /** Execution state. With a non-empty map, nodes missing from it render as `pending`. */
  state?: Record<string, NodeStatus>;
  /** Execution trace: highlights taken and not-taken edges and loop counts */
  trace?: ExecutionTrace;
  /** Graph direction: TB (top-bottom) or LR (left-right). Default: TB */
  direction?: "TB" | "LR";
  /** Title rendered above the diagram */
  title?: string;
  /**
   * Override the `classDef` style body (the part after the class name) for
   * specific statuses. Unset statuses keep the brand defaults
   * (`MERMAID_CLASS_DEFS` in theme.ts). SWEny's own surfaces pass none.
   */
  classDefs?: Partial<Record<NodeStatus, string>>;
}

/**
 * Convert a Workflow to a Mermaid flowchart diagram string.
 *
 * @example
 * ```ts
 * import { toMermaid } from '@sweny-ai/core';
 *
 * const md = toMermaid(workflow, {
 *   state: { triage: 'success', investigate: 'current' },
 *   trace: executionResult.trace,
 * });
 * // Wrap in ```mermaid fence for GitHub rendering
 * ```
 */
export function toMermaid(workflow: Workflow, options: MermaidOptions = {}): string {
  const { state = {}, trace, direction = "TB", title, classDefs = {} } = options;
  const lines: string[] = [];

  if (title) {
    lines.push("---");
    lines.push(`title: ${title}`);
    lines.push("---");
  }

  lines.push(`graph ${direction}`);

  // Build an injective real-ID → Mermaid-alias map. `sanitizeId` is lossy
  // (every non-alphanumeric char collapses to `_`), so distinct node IDs like
  // `a.b` and `a_b` would otherwise sanitize to the same alias and render as a
  // single merged node, silently corrupting the diagram. Resolve every alias
  // through this map so node declarations, edge endpoints, and class styling
  // all stay consistent and collision-free.
  const idAlias = new Map<string, string>();
  const usedAliases = new Set<string>();
  const aliasFor = (id: string): string => {
    const cached = idAlias.get(id);
    if (cached) return cached;
    const base = sanitizeId(id);
    let alias = base;
    let n = 2;
    while (usedAliases.has(alias)) alias = `${base}_${n++}`;
    usedAliases.add(alias);
    idAlias.set(id, alias);
    return alias;
  };
  // Seed aliases in node-declaration order so already-alphanumeric IDs keep
  // their byte-identical alias (and stable suffixing for any collisions).
  for (const id of Object.keys(workflow.nodes)) aliasFor(id);

  // Build node iteration counts from trace
  const nodeIterations = new Map<string, number>();
  if (trace) {
    for (const step of trace.steps) {
      nodeIterations.set(step.node, Math.max(nodeIterations.get(step.node) ?? 0, step.iteration));
    }
  }

  // Nodes
  for (const [id, node] of Object.entries(workflow.nodes)) {
    let label = escapeLabel(node.name);
    const isEntry = id === workflow.entry;
    const entryTag = isEntry ? " \u25B6" : "";

    // Show iteration count for nodes that ran multiple times
    const iterations = nodeIterations.get(id);
    const iterTag = iterations && iterations > 1 ? ` ×${iterations}` : "";

    if (isEntry) {
      lines.push(`    ${aliasFor(id)}([${label}${entryTag}${iterTag}])`);
    } else {
      lines.push(`    ${aliasFor(id)}[${label}${iterTag}]`);
    }
  }

  lines.push("");

  // Build set of taken edges from trace for lookup
  const takenEdges = new Set<string>();
  const edgeTakenCounts = new Map<string, number>();
  if (trace) {
    for (const te of trace.edges) {
      const key = `${te.from}→${te.to}`;
      takenEdges.add(key);
      edgeTakenCounts.set(key, (edgeTakenCounts.get(key) ?? 0) + 1);
    }
  }

  // Edges: track index for linkStyle directives
  const takenIndices: number[] = [];
  const notTakenIndices: number[] = [];
  let edgeIndex = 0;

  for (const edge of workflow.edges) {
    const from = aliasFor(edge.from);
    const to = aliasFor(edge.to);
    const key = `${edge.from}→${edge.to}`;
    const taken = takenEdges.has(key);
    const takenCount = edgeTakenCounts.get(key) ?? 0;

    // Build label parts
    const labelParts: string[] = [];
    const when = whenLabel(edge.when);
    if (when) labelParts.push(when);
    if (edge.max_iterations) labelParts.push(`max ${edge.max_iterations}x`);
    // Show how many times this edge was actually followed
    if (takenCount > 1) labelParts.push(`taken ${takenCount}x`);

    if (labelParts.length > 0) {
      const label = escapeLabel(labelParts.join(" · "));
      lines.push(`    ${from} -->|"${label}"| ${to}`);
    } else {
      lines.push(`    ${from} --> ${to}`);
    }

    // Track edge indices for styling
    if (trace) {
      if (taken) {
        takenIndices.push(edgeIndex);
      } else {
        notTakenIndices.push(edgeIndex);
      }
    }
    edgeIndex++;
  }

  // Node status styling (brand classDefs from theme.ts)
  const statusNodes = groupByStatus(state);

  if (statusNodes.size > 0) {
    const unreached = Object.keys(workflow.nodes).filter((id) => !(id in state));
    if (unreached.length > 0) statusNodes.set("pending", [...(statusNodes.get("pending") ?? []), ...unreached]);
    lines.push("");
    for (const status of ["current", "success", "failed", "skipped", "pending"] as const) {
      lines.push(`    classDef ${status} ${classDefs[status] ?? MERMAID_CLASS_DEFS[status]}`);
    }

    for (const [status, ids] of statusNodes) {
      const sanitized = ids.map(aliasFor).join(",");
      lines.push(`    class ${sanitized} ${status}`);
    }
  }

  // Edge styling: taken edges bold brand blue, not-taken edges dashed slate
  if (trace) {
    lines.push("");
    if (takenIndices.length > 0) {
      lines.push(`    linkStyle ${takenIndices.join(",")} ${MERMAID_EDGE_STYLES.taken}`);
    }
    if (notTakenIndices.length > 0) {
      lines.push(`    linkStyle ${notTakenIndices.join(",")} ${MERMAID_EDGE_STYLES.notTaken}`);
    }
  }

  return lines.join("\n");
}

/**
 * Convenience: wrap toMermaid output in a fenced code block
 * ready for GitHub markdown.
 */
export function toMermaidBlock(workflow: Workflow, options: MermaidOptions = {}): string {
  return "```mermaid\n" + toMermaid(workflow, options) + "\n```";
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Mermaid node IDs must be alphanumeric + underscores + hyphens */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Escape characters that break Mermaid labels */
function escapeLabel(text: string): string {
  // `|` must be escaped too: edge labels are emitted as `-->|"label"|`, so a
  // literal `|` inside the label (e.g. an edge `when` of "high | critical")
  // terminates Mermaid's edge-label token and corrupts the edge. `&#124;`
  // renders as a literal `|`, consistent with the existing `&#91;`/`&#93;`.
  return text.replace(/"/g, "&quot;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/\|/g, "&#124;");
}

/** Group node IDs by their status */
function groupByStatus(state: Record<string, NodeStatus>): Map<NodeStatus, string[]> {
  const groups = new Map<NodeStatus, string[]>();
  for (const [id, status] of Object.entries(state)) {
    let list = groups.get(status);
    if (!list) {
      list = [];
      groups.set(status, list);
    }
    list.push(id);
  }
  return groups;
}
