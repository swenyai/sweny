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

// ── Graph helpers ────────────────────────────────────────────────

function getChildren(workflow: Workflow): Map<string, string[]> {
  const children = new Map<string, string[]>(Object.keys(workflow.nodes).map((id) => [id, []]));
  for (const edge of workflow.edges) {
    children.get(edge.from)?.push(edge.to);
  }
  return children;
}

// ── Box rendering ────────────────────────────────────────────────

function getNodeDetail(nodeRenderState: NodeRenderState): string {
  const { state, toolCallCount, startedAt, finishedAt } = nodeRenderState;
  if (state === "running" && startedAt != null) {
    const elapsed = formatElapsed(Date.now() - startedAt);
    return chalk.dim(` ${elapsed}`);
  } else if (state === "completed" && toolCallCount > 0) {
    return chalk.dim(` ${toolCallCount} call${toolCallCount === 1 ? "" : "s"}`);
  } else if (state === "failed" && startedAt != null && finishedAt != null) {
    const elapsed = formatElapsed(finishedAt - startedAt);
    return chalk.dim(` ${elapsed}`);
  }
  return "";
}

/**
 * Word-wrap a node name into lines that fit within maxChars.
 * Splits on spaces. If a single word exceeds maxChars, it's placed on its own line.
 */
function wrapName(name: string, maxChars: number): string[] {
  const words = name.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Render a single node as a box.
 * @param innerWidth - the uniform inner width for all boxes
 * @param indent - number of leading spaces
 * @param topConnector - "plain" (┌───┐), "arrow" (┌───▼───┐)
 * @param bottomConnector - "plain" (└───┘), "tee" (└───┬───┘)
 * @param connectorCol - absolute column for ▼/┬ (default: centered in the box)
 */
function renderNodeBox(
  nodeName: string,
  nodeRenderState: NodeRenderState,
  innerWidth: number,
  indent: number,
  topConnector: "plain" | "arrow",
  bottomConnector: "plain" | "tee",
  connectorCol?: number,
): string[] {
  const icon = statusIcon(nodeRenderState.state);
  const detail = getNodeDetail(nodeRenderState);
  const pad = " ".repeat(indent);
  // Position of connector character within the inner width (offset from ┌/└)
  const mid = connectorCol != null ? connectorCol - indent - 1 : Math.floor(innerWidth / 2);

  // Top border
  let top: string;
  if (topConnector === "arrow") {
    const leftDashes = "─".repeat(mid);
    const rightDashes = "─".repeat(innerWidth - mid - 1);
    top = `${pad}┌${leftDashes}▼${rightDashes}┐`;
  } else {
    top = `${pad}┌${"─".repeat(innerWidth)}┐`;
  }

  // Bottom border
  let bottom: string;
  if (bottomConnector === "tee") {
    const leftDashes = "─".repeat(mid);
    const rightDashes = "─".repeat(innerWidth - mid - 1);
    bottom = `${pad}└${leftDashes}┬${rightDashes}┘`;
  } else {
    bottom = `${pad}└${"─".repeat(innerWidth)}┘`;
  }

  // Content lines — icon on first line, wrapped name
  // Available space for text: innerWidth - 4 (1 space + icon + 1 space + text + padding + 1 space)
  // "│ ○ Name...padding │"  → icon(1) + spaces(2) + name + pad
  const iconVis = stripAnsi(icon); // 1 char
  const detailVis = stripAnsi(detail);
  // Max text width for name: innerWidth - 2 (margins) - 2 (icon + space)
  const maxNameWidth = innerWidth - 4; // "│ X name_here... │" → 1+1+1+1 = 4 overhead

  const nameLines = wrapName(nodeName, maxNameWidth);
  const contentLines: string[] = [];
  for (let li = 0; li < nameLines.length; li++) {
    const isFirst = li === 0;
    let lineText: string;
    let lineVisLen: number;

    if (isFirst) {
      // First line includes icon and possibly detail
      const namePart = nameLines[li];
      // Check if detail fits on first line
      if (nameLines.length === 1 && namePart.length + detailVis.length <= maxNameWidth) {
        lineText = `${icon} ${namePart}${detail}`;
        lineVisLen = iconVis.length + 1 + namePart.length + detailVis.length;
      } else {
        lineText = `${icon} ${namePart}`;
        lineVisLen = iconVis.length + 1 + namePart.length;
      }
    } else {
      // Continuation lines indented to align with name start (after "X ")
      lineText = `  ${nameLines[li]}`;
      lineVisLen = 2 + nameLines[li].length;
    }

    const rightPad = Math.max(0, innerWidth - 2 - lineVisLen);
    contentLines.push(`${pad}│ ${lineText}${" ".repeat(rightPad)} │`);
  }

  // If detail didn't fit on the first line of a multi-line name, add it to last line
  // Actually, for simplicity, detail goes on the first line only when name is single-line

  return [top, ...contentLines, bottom];
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
    const children = getChildren(this.workflow);

    // Pre-compute uniform inner width from the max node name across ALL nodes
    const MIN_INNER = 20;
    let maxNameLen = 0;
    for (const nodeId of this.topoOrder) {
      const node = this.workflow.nodes[nodeId];
      if (node) {
        maxNameLen = Math.max(maxNameLen, node.name.length);
      }
    }
    // innerWidth = "│ X " + name + " │" → name + 4 + some padding
    const boxInnerWidth = Math.max(maxNameLen + 4, MIN_INNER);

    const indent = 2; // global left indent for main-column boxes
    const midCol = indent + 1 + Math.floor(boxInnerWidth / 2); // center column for connectors (indent + border + half inner)

    const lines: string[] = [];
    lines.push(`  ${chalk.bold(this.workflow.name)}`);
    lines.push("");

    // Build a set of nodes that have been rendered (to handle branches)
    const rendered = new Set<string>();

    // Track the column where the incoming connector arrives from (for merge nodes after branches)
    // When set, the next node's ▼ is placed at this column instead of centered
    let incomingConnectorCol: number | undefined;

    for (let i = 0; i < this.topoOrder.length; i++) {
      const nodeId = this.topoOrder[i];
      if (rendered.has(nodeId)) continue;
      const node = this.workflow.nodes[nodeId];
      if (!node) continue;

      const state = this.nodeStates.get(nodeId) ?? { state: "pending" as NodeState, toolCallCount: 0 };
      const kids = children.get(nodeId) ?? [];

      // Check if this node has exactly 2 children → render fork
      if (kids.length === 2) {
        // Render this node with a tee bottom
        const isFirstRendered = rendered.size === 0;
        const boxLines = renderNodeBox(
          node.name,
          state,
          boxInnerWidth,
          indent,
          isFirstRendered ? "plain" : "arrow",
          "tee",
          incomingConnectorCol,
        );
        lines.push(...boxLines);
        rendered.add(nodeId);
        incomingConnectorCol = undefined;

        // Render fork connector and side-by-side children
        const leftId = kids[0];
        const rightId = kids[1];
        const leftNode = this.workflow.nodes[leftId];
        const rightNode = this.workflow.nodes[rightId];
        if (!leftNode || !rightNode) continue;

        const leftState = this.nodeStates.get(leftId) ?? { state: "pending" as NodeState, toolCallCount: 0 };
        const rightState = this.nodeStates.get(rightId) ?? { state: "pending" as NodeState, toolCallCount: 0 };

        // Determine child box widths — each child gets its own width based on its name
        const leftKids = children.get(leftId) ?? [];
        const rightKids = children.get(rightId) ?? [];

        // For side-by-side, compute widths that fit
        const leftInner = Math.max(leftNode.name.length + 4, 14);
        const rightInner = Math.max(rightNode.name.length + 4, 14);

        // Gap between the two child boxes: 1 space
        const gap = 1;
        const leftBoxOuter = leftInner + 2; // +2 for ┌/│ and ┐/│
        const rightBoxOuter = rightInner + 2;

        // Center the pair around midCol
        const totalWidth = leftBoxOuter + gap + rightBoxOuter;
        const pairStart = Math.max(0, midCol - Math.floor(totalWidth / 2));
        const leftIndent = pairStart;
        const rightIndent = pairStart + leftBoxOuter + gap;

        // Left box center and right box center (absolute columns)
        const leftCenter = leftIndent + 1 + Math.floor(leftInner / 2);
        const rightCenter = rightIndent + 1 + Math.floor(rightInner / 2);

        // Vertical connector from parent ┬
        lines.push(" ".repeat(midCol) + "│");

        // Fork line: ┌───┴───┐ with horizontal line from leftCenter to rightCenter
        const forkLineChars: string[] = new Array(Math.max(rightCenter, midCol) + 1).fill(" ");
        for (let c = leftCenter; c <= rightCenter; c++) {
          forkLineChars[c] = "─";
        }
        forkLineChars[leftCenter] = "┌";
        forkLineChars[rightCenter] = "┐";
        forkLineChars[midCol] = "┴";
        lines.push(forkLineChars.join(""));

        // Vertical connectors from fork to child boxes
        const vertLineChars: string[] = new Array(Math.max(rightCenter, midCol) + 1).fill(" ");
        vertLineChars[leftCenter] = "│";
        vertLineChars[rightCenter] = "│";
        lines.push(vertLineChars.join(""));

        // Render left and right child boxes side by side
        const leftBox = renderNodeBox(
          leftNode.name,
          leftState,
          leftInner,
          leftIndent,
          "arrow",
          leftKids.length > 0 ? "tee" : "plain",
          leftCenter,
        );
        const rightBox = renderNodeBox(
          rightNode.name,
          rightState,
          rightInner,
          rightIndent,
          "arrow",
          rightKids.length > 0 ? "tee" : "plain",
          rightCenter,
        );

        // Merge left and right box lines side-by-side
        const maxBoxLines = Math.max(leftBox.length, rightBox.length);
        for (let li = 0; li < maxBoxLines; li++) {
          const leftLine = li < leftBox.length ? leftBox[li] : "";
          const rightLine = li < rightBox.length ? rightBox[li] : "";

          const leftVisLen = visLen(leftLine);

          if (rightLine.length > 0) {
            const rightContent = rightLine.trimStart();
            const rightStartCol = visLen(rightLine) - visLen(rightLine.trimStart());
            const neededPad = Math.max(0, rightStartCol - leftVisLen);
            lines.push(leftLine + " ".repeat(neededPad) + rightContent);
          } else {
            lines.push(leftLine);
          }
        }

        rendered.add(leftId);
        rendered.add(rightId);

        // Find the continuation/merge node
        const leftNextIds = leftKids;
        const rightNextIds = rightKids;

        // Find merge point: a node reachable from either branch
        let mergeNodeId: string | undefined;
        const leftNextSet = new Set(leftNextIds);
        for (const rn of rightNextIds) {
          if (leftNextSet.has(rn)) {
            mergeNodeId = rn;
            break;
          }
        }

        // If only one branch has a continuation, use that
        if (!mergeNodeId && leftNextIds.length > 0) {
          mergeNodeId = leftNextIds[0];
        }

        // Render connector from left child down to merge node
        if (mergeNodeId && leftKids.length > 0) {
          // The left child's ┬ is at leftCenter
          lines.push(" ".repeat(leftCenter) + "│");
          // Tell the merge node to place its ▼ at leftCenter
          incomingConnectorCol = leftCenter;
        }
      } else {
        // Regular sequential node
        const isFirstRendered = rendered.size === 0;
        const hasDownstream = kids.length > 0;

        const boxLines = renderNodeBox(
          node.name,
          state,
          boxInnerWidth,
          indent,
          isFirstRendered ? "plain" : "arrow",
          hasDownstream ? "tee" : "plain",
          incomingConnectorCol,
        );
        lines.push(...boxLines);
        rendered.add(nodeId);
        incomingConnectorCol = undefined;

        // Add vertical connector if there's a next node
        if (hasDownstream) {
          lines.push(" ".repeat(midCol) + "│");
        }
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
