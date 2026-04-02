/**
 * Mermaid diagram export
 *
 * Converts a Workflow into a Mermaid flowchart string.
 * Renders natively in GitHub (job summaries, READMEs, issues, PRs),
 * VS Code preview, documentation sites, and anywhere Mermaid is supported.
 *
 * Accepts optional execution state to color nodes by status
 * (current/success/failed/skipped).
 */

import type { Workflow } from "./types.js";

export type NodeStatus = "current" | "success" | "failed" | "skipped";

export interface MermaidOptions {
  /** Execution state — nodes not in this map render as default (pending) */
  state?: Record<string, NodeStatus>;
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
 * });
 * // Wrap in ```mermaid fence for GitHub rendering
 * ```
 */
export function toMermaid(workflow: Workflow, options: MermaidOptions = {}): string {
  const { state = {}, direction = "TB", title } = options;
  const lines: string[] = [];

  if (title) {
    lines.push("---");
    lines.push(`title: ${title}`);
    lines.push("---");
  }

  lines.push(`graph ${direction}`);

  // Nodes
  for (const [id, node] of Object.entries(workflow.nodes)) {
    const label = escapeLabel(node.name);
    const isEntry = id === workflow.entry;
    const entryTag = isEntry ? " \\u25B6" : "";
    // Use stadium shape ([...]) for entry, rounded ([(...)])  for others
    if (isEntry) {
      lines.push(`    ${sanitizeId(id)}([${label}${entryTag}])`);
    } else {
      lines.push(`    ${sanitizeId(id)}[${label}]`);
    }
  }

  lines.push("");

  // Edges
  for (const edge of workflow.edges) {
    const from = sanitizeId(edge.from);
    const to = sanitizeId(edge.to);

    if (edge.when) {
      const label = escapeLabel(edge.when);
      if (edge.max_iterations) {
        lines.push(`    ${from} -->|"${label} (max ${edge.max_iterations}x)"| ${to}`);
      } else {
        lines.push(`    ${from} -->|"${label}"| ${to}`);
      }
    } else if (edge.max_iterations) {
      lines.push(`    ${from} -->|"max ${edge.max_iterations}x"| ${to}`);
    } else {
      lines.push(`    ${from} --> ${to}`);
    }
  }

  // Status styling
  const statusNodes = groupByStatus(state);

  if (statusNodes.size > 0) {
    lines.push("");

    // Define style classes
    lines.push("    classDef current fill:#3b82f6,stroke:#2563eb,color:#fff,stroke-width:2px");
    lines.push("    classDef success fill:#22c55e,stroke:#16a34a,color:#fff,stroke-width:2px");
    lines.push("    classDef failed fill:#ef4444,stroke:#dc2626,color:#fff,stroke-width:2px");
    lines.push("    classDef skipped fill:#6b7280,stroke:#4b5563,color:#fff,stroke-dasharray:5 5");

    for (const [status, ids] of statusNodes) {
      const sanitized = ids.map(sanitizeId).join(",");
      lines.push(`    class ${sanitized} ${status}`);
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
