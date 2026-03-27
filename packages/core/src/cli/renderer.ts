import chalk from "chalk";
import type { Workflow, ExecutionEvent } from "../types.js";

// ── Types ────────────────────────────────────────────────────────

export type NodeState = "pending" | "running" | "completed" | "failed";

interface NodeRenderState {
  state: NodeState;
  toolCallCount: number;
  startedAt?: number;
  finishedAt?: number;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Strip ANSI escape codes for accurate visible-width calculations. */
export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

function visLen(str: string): number {
  return stripAnsi(str).length;
}

function formatElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ── Topological sort ─────────────────────────────────────────────

/**
 * Returns node IDs in topological order starting from the entry node.
 * Uses Kahn's algorithm (BFS from entry) to respect edge ordering.
 */
function topologicalOrder(workflow: Workflow): string[] {
  const nodeIds = Object.keys(workflow.nodes);
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const children = new Map<string, string[]>(nodeIds.map((id) => [id, []]));

  for (const edge of workflow.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    children.get(edge.from)?.push(edge.to);
  }

  const queue: string[] = [workflow.entry];
  const visited = new Set<string>([workflow.entry]);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);

    for (const child of children.get(current) ?? []) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }

  // Append any nodes not reachable from entry (disconnected subgraphs)
  for (const id of nodeIds) {
    if (!visited.has(id)) {
      order.push(id);
    }
  }

  return order;
}

// ── Status icons + colors ────────────────────────────────────────

function statusIcon(state: NodeState): string {
  switch (state) {
    case "completed":
      return chalk.green("●");
    case "running":
      return chalk.yellow("◉");
    case "pending":
      return chalk.gray("○");
    case "failed":
      return chalk.red("✕");
  }
}

// ── Box rendering ────────────────────────────────────────────────

/** Render a single node as a box with its status. */
function renderNodeBox(nodeId: string, nodeName: string, nodeRenderState: NodeRenderState): string {
  const { state, toolCallCount, startedAt, finishedAt } = nodeRenderState;

  const icon = statusIcon(state);

  // Detail suffix: elapsed time for running nodes, tool call count for completed
  let detail = "";
  if (state === "running" && startedAt != null) {
    const elapsed = formatElapsed(Date.now() - startedAt);
    detail = chalk.dim(` ${elapsed}`);
  } else if (state === "completed" && toolCallCount > 0) {
    detail = chalk.dim(` ${toolCallCount} call${toolCallCount === 1 ? "" : "s"}`);
  } else if (state === "failed" && startedAt != null && finishedAt != null) {
    const elapsed = formatElapsed(finishedAt - startedAt);
    detail = chalk.dim(` ${elapsed}`);
  }

  // Build visible label and compute box width
  const labelVisible = `${stripAnsi(icon)} ${nodeName}${stripAnsi(detail)}`;
  const innerWidth = Math.max(labelVisible.length + 2, 20); // at least 20 wide, 1 space each side
  const horizontalLine = "─".repeat(innerWidth);

  const top = `  ┌${horizontalLine}┐`;
  const bottom = `  └${horizontalLine}┘`;

  // Pad label to fill inner width
  const pad = Math.max(0, innerWidth - labelVisible.length - 2); // subtract the 1-space margins
  const contentLine = `  │ ${icon} ${nodeName}${detail}${" ".repeat(pad)} │`;

  return [top, contentLine, bottom].join("\n");
}

/** Render a vertical arrow connector between two boxes. */
function renderArrow(): string {
  return "       │";
}

// ── Legend ───────────────────────────────────────────────────────

function renderLegend(): string {
  const items = [
    `${chalk.green("●")} completed`,
    `${chalk.yellow("◉")} running`,
    `${chalk.gray("○")} pending`,
    `${chalk.red("✕")} failed`,
  ];
  return `\n  ${chalk.dim(items.join("   "))}`;
}

// ── DagRenderer ─────────────────────────────────────────────────

export interface DagRendererOptions {
  /** If true, call render() automatically on every update(). Default: false. */
  animate?: boolean;
  /** Stream to write to when animate=true or render() is called. Default: process.stderr. */
  stream?: NodeJS.WriteStream;
}

export class DagRenderer {
  private readonly workflow: Workflow;
  private readonly options: Required<DagRendererOptions>;
  private readonly nodeStates: Map<string, NodeRenderState>;
  private readonly topoOrder: string[];

  /** Number of lines written in the last render pass (for cursor repositioning). */
  private lastLineCount = 0;

  constructor(workflow: Workflow, options: DagRendererOptions = {}) {
    this.workflow = workflow;
    this.options = {
      animate: options.animate ?? false,
      stream:
        options.stream ??
        (typeof process !== "undefined" ? process.stderr : (undefined as unknown as NodeJS.WriteStream)),
    };

    this.nodeStates = new Map(
      Object.keys(workflow.nodes).map((id) => [id, { state: "pending" as NodeState, toolCallCount: 0 }]),
    );

    this.topoOrder = topologicalOrder(workflow);
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Update renderer state from an execution event. Re-renders if animate=true. */
  update(event: ExecutionEvent): void {
    switch (event.type) {
      case "node:enter": {
        const s = this.getOrCreate(event.node);
        s.state = "running";
        s.startedAt = Date.now();
        break;
      }
      case "tool:call": {
        const s = this.getOrCreate(event.node);
        s.toolCallCount++;
        break;
      }
      case "node:exit": {
        const s = this.getOrCreate(event.node);
        s.state = event.result.status === "failed" ? "failed" : "completed";
        s.finishedAt = Date.now();
        break;
      }
      // These events don't affect per-node rendering state
      case "workflow:start":
      case "workflow:end":
      case "tool:result":
      case "route":
        break;
    }

    if (this.options.animate) {
      this.render();
    }
  }

  /** Returns the current state of a node. Returns "pending" for unknown nodes. */
  getNodeState(nodeId: string): NodeState {
    return this.nodeStates.get(nodeId)?.state ?? "pending";
  }

  /** Returns the number of tool calls for a node. Returns 0 for unknown nodes. */
  getToolCallCount(nodeId: string): number {
    return this.nodeStates.get(nodeId)?.toolCallCount ?? 0;
  }

  /** Renders the DAG to a string (no side effects). */
  renderToString(): string {
    const lines: string[] = [];

    lines.push(`  ${chalk.bold(this.workflow.name)}`);
    lines.push("");

    for (let i = 0; i < this.topoOrder.length; i++) {
      const nodeId = this.topoOrder[i];
      const node = this.workflow.nodes[nodeId];
      if (!node) continue;

      const state = this.nodeStates.get(nodeId) ?? { state: "pending" as NodeState, toolCallCount: 0 };
      lines.push(renderNodeBox(nodeId, node.name, state));

      // Add arrow connector between nodes (not after the last one)
      if (i < this.topoOrder.length - 1) {
        lines.push(renderArrow());
      }
    }

    lines.push(renderLegend());

    return lines.join("\n");
  }

  /**
   * Writes the current DAG render to the stream.
   * When animate=true, uses cursor manipulation to update in place.
   */
  render(): void {
    const output = this.renderToString();
    const lineCount = output.split("\n").length;
    const stream = this.options.stream;

    if (!stream) return;

    if (this.options.animate && this.lastLineCount > 0) {
      // Move cursor up to overwrite previous render
      stream.write(`\x1B[${this.lastLineCount}A`);
    }

    stream.write(output + "\n");
    this.lastLineCount = lineCount + 1; // +1 for the trailing newline
  }

  // ── Private helpers ────────────────────────────────────────────

  private getOrCreate(nodeId: string): NodeRenderState {
    let s = this.nodeStates.get(nodeId);
    if (!s) {
      s = { state: "pending", toolCallCount: 0 };
      this.nodeStates.set(nodeId, s);
    }
    return s;
  }
}
