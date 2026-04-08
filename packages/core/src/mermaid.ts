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

export type NodeStatus = "current" | "success" | "failed" | "skipped";

export interface MermaidOptions {
  /** Execution state — nodes not in this map render as default (pending) */
  state?: Record<string, NodeStatus>;
  /** Execution trace — highlights taken/not-taken edges and loop counts */
  trace?: ExecutionTrace;
  /** Graph direction: TB (top-bottom) or LR (left-right). Default: TB */
  direction?: "TB" | "LR";
  /** Title rendered above the diagram */
  title?: string;
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
  const { state = {}, trace, direction = "TB", title } = options;
  const lines: string[] = [];

  if (title) {
    lines.push("---");
    lines.push(`title: ${title}`);
    lines.push("---");
  }

  lines.push(`graph ${direction}`);

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
      lines.push(`    ${sanitizeId(id)}([${label}${entryTag}${iterTag}])`);
    } else {
      lines.push(`    ${sanitizeId(id)}[${label}${iterTag}]`);
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

  // Edges — track index for linkStyle directives
  const takenIndices: number[] = [];
  const notTakenIndices: number[] = [];
  let edgeIndex = 0;

  for (const edge of workflow.edges) {
    const from = sanitizeId(edge.from);
    const to = sanitizeId(edge.to);
    const key = `${edge.from}→${edge.to}`;
    const taken = takenEdges.has(key);
    const takenCount = edgeTakenCounts.get(key) ?? 0;

    // Build label parts
    const labelParts: string[] = [];
    if (edge.when) labelParts.push(edge.when);
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

  // Node status styling
  const statusNodes = groupByStatus(state);

  if (statusNodes.size > 0) {
    lines.push("");
    lines.push("    classDef current fill:#3b82f6,stroke:#2563eb,color:#fff,stroke-width:2px");
    lines.push("    classDef success fill:#22c55e,stroke:#16a34a,color:#fff,stroke-width:2px");
    lines.push("    classDef failed fill:#ef4444,stroke:#dc2626,color:#fff,stroke-width:2px");
    lines.push("    classDef skipped fill:#6b7280,stroke:#4b5563,color:#fff,stroke-dasharray:5 5");

    for (const [status, ids] of statusNodes) {
      const sanitized = ids.map(sanitizeId).join(",");
      lines.push(`    class ${sanitized} ${status}`);
    }
  }

  // Edge styling — taken edges bold green, not-taken edges dashed gray
  if (trace) {
    lines.push("");
    if (takenIndices.length > 0) {
      lines.push(`    linkStyle ${takenIndices.join(",")} stroke:#22c55e,stroke-width:3px`);
    }
    if (notTakenIndices.length > 0) {
      lines.push(`    linkStyle ${notTakenIndices.join(",")} stroke:#6b7280,stroke-width:1px,stroke-dasharray:5 5`);
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
  return text.replace(/"/g, "&quot;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
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
