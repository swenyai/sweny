# Workflow Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `buildWorkflow()` / `refineWorkflow()` functions, `sweny workflow create` / `edit` CLI commands, and fix the DagRenderer to support branching + uniform box widths.

**Architecture:** One new file (`workflow-builder.ts`) for generation logic, modifications to `renderer.ts` for branching DAG layout, and additions to `cli/main.ts` for the two new CLI commands. Tests use MockClaude with scripted responses.

**Tech Stack:** TypeScript, Vitest, Zod, chalk, commander, yaml, readline

---

## File Structure

| File | Responsibility |
|------|----------------|
| Create: `packages/core/src/workflow-builder.ts` | `buildWorkflow()` and `refineWorkflow()` — prompt construction, Claude call, Zod validation |
| Create: `packages/core/src/workflow-builder.test.ts` | Tests for buildWorkflow/refineWorkflow using MockClaude |
| Modify: `packages/core/src/cli/renderer.ts` | Rewrite renderToString to support branching layout, uniform box widths, clean connectors |
| Modify: `packages/core/src/cli/renderer.test.ts` | Add tests for branching, uniform widths, connector characters |
| Modify: `packages/core/src/cli/main.ts` | Add `workflow create` and `workflow edit` commands |
| Modify: `packages/core/src/index.ts` | Export `buildWorkflow`, `refineWorkflow`, `BuildWorkflowOptions` |

---

### Task 1: `buildWorkflow()` and `refineWorkflow()`

**Files:**
- Create: `packages/core/src/workflow-builder.ts`
- Create: `packages/core/src/workflow-builder.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/workflow-builder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildWorkflow, refineWorkflow } from "./workflow-builder.js";
import { MockClaude } from "./testing.js";
import type { Workflow, Skill } from "./types.js";

const testSkills: Skill[] = [
  {
    id: "sentry",
    name: "Sentry",
    description: "Error monitoring and tracking",
    category: "observability",
    config: { SENTRY_AUTH_TOKEN: { description: "Auth token", env: "SENTRY_AUTH_TOKEN" } },
    tools: [],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Team messaging and notifications",
    category: "notification",
    config: { SLACK_BOT_TOKEN: { description: "Bot token", env: "SLACK_BOT_TOKEN" } },
    tools: [],
  },
];

const validWorkflowResponse: Workflow = {
  id: "error-monitor",
  name: "Error Monitor",
  description: "Monitor errors and notify",
  entry: "check_errors",
  nodes: {
    check_errors: {
      name: "Check Errors",
      instruction: "Query Sentry for unresolved errors from the last 24 hours. Group by fingerprint.",
      skills: ["sentry"],
    },
    notify: {
      name: "Notify",
      instruction: "Post a summary of findings to Slack.",
      skills: ["slack"],
    },
  },
  edges: [{ from: "check_errors", to: "notify" }],
};

describe("buildWorkflow", () => {
  it("returns a validated Workflow when Claude produces valid output", async () => {
    const claude = new MockClaude({
      responses: {
        build: { data: validWorkflowResponse },
      },
    });

    const result = await buildWorkflow("monitor sentry errors, notify slack", {
      claude,
      skills: testSkills,
    });

    expect(result.id).toBe("error-monitor");
    expect(result.entry).toBe("check_errors");
    expect(Object.keys(result.nodes)).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it("throws when Claude produces invalid output (missing entry)", async () => {
    const claude = new MockClaude({
      responses: {
        build: {
          data: {
            id: "bad",
            name: "Bad",
            description: "",
            entry: "nonexistent",
            nodes: { a: { name: "A", instruction: "do stuff", skills: [] } },
            edges: [],
          },
        },
      },
    });

    await expect(
      buildWorkflow("something", { claude, skills: testSkills }),
    ).rejects.toThrow();
  });

  it("throws when Claude returns empty data", async () => {
    const claude = new MockClaude({
      responses: {
        build: { data: {} },
      },
    });

    await expect(
      buildWorkflow("something", { claude, skills: testSkills }),
    ).rejects.toThrow();
  });

  it("includes skill descriptions in the prompt context", async () => {
    let capturedInstruction = "";
    const claude = new MockClaude({
      responses: {
        build: { data: validWorkflowResponse },
      },
    });
    const originalRun = claude.run.bind(claude);
    claude.run = async (opts) => {
      capturedInstruction = opts.instruction;
      return originalRun(opts);
    };

    await buildWorkflow("test", { claude, skills: testSkills });

    expect(capturedInstruction).toContain("sentry");
    expect(capturedInstruction).toContain("Sentry");
    expect(capturedInstruction).toContain("slack");
    expect(capturedInstruction).toContain("Slack");
  });
});

describe("refineWorkflow", () => {
  it("returns a modified workflow", async () => {
    const refined: Workflow = {
      ...validWorkflowResponse,
      nodes: {
        ...validWorkflowResponse.nodes,
        alert: {
          name: "Alert",
          instruction: "Send urgent alert for critical errors.",
          skills: ["slack"],
        },
      },
      edges: [
        { from: "check_errors", to: "notify" },
        { from: "check_errors", to: "alert", when: "Critical errors found" },
      ],
    };

    const claude = new MockClaude({
      responses: {
        refine: { data: refined },
      },
    });

    const result = await refineWorkflow(validWorkflowResponse, "add an urgent alert path", {
      claude,
      skills: testSkills,
    });

    expect(Object.keys(result.nodes)).toHaveLength(3);
    expect(result.nodes.alert).toBeDefined();
  });

  it("includes the current workflow in the prompt", async () => {
    let capturedInstruction = "";
    const claude = new MockClaude({
      responses: {
        refine: { data: validWorkflowResponse },
      },
    });
    const originalRun = claude.run.bind(claude);
    claude.run = async (opts) => {
      capturedInstruction = opts.instruction;
      return originalRun(opts);
    };

    await refineWorkflow(validWorkflowResponse, "change something", {
      claude,
      skills: testSkills,
    });

    expect(capturedInstruction).toContain("check_errors");
    expect(capturedInstruction).toContain("error-monitor");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/workflow-builder.test.ts`
Expected: FAIL — module `./workflow-builder.js` not found

- [ ] **Step 3: Implement `buildWorkflow()` and `refineWorkflow()`**

Create `packages/core/src/workflow-builder.ts`:

```ts
/**
 * Workflow Builder
 *
 * Generate and refine SWEny workflow definitions from natural language
 * descriptions using the Claude interface. Validates output with Zod
 * and structural checks before returning.
 */

import type { Claude, Workflow, Skill, Logger } from "./types.js";
import { consoleLogger } from "./types.js";
import { workflowZ, validateWorkflow, workflowJsonSchema } from "./schema.js";

export interface BuildWorkflowOptions {
  claude: Claude;
  skills: Skill[];
  logger?: Logger;
}

/**
 * Build the system prompt that teaches Claude how to generate workflows.
 */
function buildSystemPrompt(skills: Skill[]): string {
  const skillList = skills
    .map((s) => `- **${s.id}** (${s.category}): ${s.description}`)
    .join("\n");

  return `You are a workflow designer for SWEny, an autonomous engineering tool.
Your job is to create a workflow definition as a JSON object.

## Workflow Schema

\`\`\`json
${JSON.stringify(workflowJsonSchema, null, 2)}
\`\`\`

## Available Skills

${skillList}

## Rules

- Use \`snake_case\` for node IDs (e.g., \`gather_errors\`, \`create_ticket\`)
- Set \`entry\` to the first node in the workflow
- Only reference skills from the list above in each node's \`skills\` array
- Every node must be reachable from the entry node via edges
- Use conditional edges (\`when\` field) for branching logic

## Instruction Quality

Each node's \`instruction\` field is a detailed prompt that Claude will execute autonomously.
Write instructions as if briefing a skilled engineer who has access to the node's tools
but no other context. Be specific about:

- WHAT to query/search/create (not just "check for errors" — specify filters, time ranges, grouping)
- HOW to interpret results (what counts as actionable? what thresholds matter?)
- WHAT output to produce (structured findings, not just "summarize")
- HOW to handle edge cases (no results found, too many results, ambiguous data)

Bad:  "Query Sentry for errors"
Good: "Query Sentry for unresolved errors from the last 24 hours. Group by issue
       fingerprint. For each group, note: error count, affected services, first/last
       seen timestamps, and stack trace summary. Prioritize by frequency × recency.
       If no errors found, report that explicitly so downstream nodes can skip."

## Output

Respond with ONLY a JSON object matching the Workflow schema. No markdown, no explanation.`;
}

/**
 * Extract and validate a Workflow from a Claude NodeResult.
 */
function extractWorkflow(data: Record<string, unknown>): Workflow {
  // Remove the 'summary' key that ClaudeClient adds
  const { summary, ...rest } = data;

  const workflow = workflowZ.parse(rest);

  const errors = validateWorkflow(workflow);
  if (errors.length > 0) {
    const messages = errors.map((e) => e.message).join("\n  ");
    throw new Error(`Generated workflow has structural errors:\n  ${messages}`);
  }

  return workflow as Workflow;
}

/**
 * Generate a new workflow from a natural language description.
 */
export async function buildWorkflow(
  description: string,
  options: BuildWorkflowOptions,
): Promise<Workflow> {
  const { claude, skills, logger = consoleLogger } = options;

  const systemPrompt = buildSystemPrompt(skills);
  const instruction = `${systemPrompt}\n\n## User Request\n\n${description}`;

  logger.info("Generating workflow from description...");

  const result = await claude.run({
    instruction,
    context: {},
    tools: [],
    outputSchema: workflowJsonSchema as Record<string, unknown>,
  });

  if (result.status === "failed") {
    throw new Error(`Workflow generation failed: ${result.data.error ?? "Unknown error"}`);
  }

  return extractWorkflow(result.data);
}

/**
 * Refine an existing workflow based on an edit instruction.
 */
export async function refineWorkflow(
  workflow: Workflow,
  instruction: string,
  options: BuildWorkflowOptions,
): Promise<Workflow> {
  const { claude, skills, logger = consoleLogger } = options;

  const systemPrompt = buildSystemPrompt(skills);
  const fullInstruction = `${systemPrompt}

## Current Workflow

\`\`\`json
${JSON.stringify(workflow, null, 2)}
\`\`\`

## Edit Request

${instruction}

Respond with the COMPLETE updated workflow JSON (not a diff).`;

  logger.info("Refining workflow...");

  const result = await claude.run({
    instruction: fullInstruction,
    context: {},
    tools: [],
    outputSchema: workflowJsonSchema as Record<string, unknown>,
  });

  if (result.status === "failed") {
    throw new Error(`Workflow refinement failed: ${result.data.error ?? "Unknown error"}`);
  }

  return extractWorkflow(result.data);
}
```

- [ ] **Step 4: Add exports to `packages/core/src/index.ts`**

Add after the schema exports (line 74):

```ts
// Workflow builder
export { buildWorkflow, refineWorkflow } from "./workflow-builder.js";
export type { BuildWorkflowOptions } from "./workflow-builder.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/workflow-builder.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/workflow-builder.ts packages/core/src/workflow-builder.test.ts packages/core/src/index.ts
git commit -m "feat(core): add buildWorkflow and refineWorkflow functions"
```

---

### Task 2: DagRenderer — Uniform Box Widths + Clean Connectors

**Files:**
- Modify: `packages/core/src/cli/renderer.ts`
- Modify: `packages/core/src/cli/renderer.test.ts`

- [ ] **Step 1: Add tests for uniform box widths and connector characters**

Add to `packages/core/src/cli/renderer.test.ts`:

```ts
import { stripAnsi } from "./renderer.js";

const unevenWorkflow: Workflow = {
  id: "uneven",
  name: "Uneven Names",
  description: "",
  nodes: {
    a: { name: "Hi", instruction: "A", skills: [] },
    b: { name: "A Very Long Node Name Here", instruction: "B", skills: [] },
    c: { name: "Mid", instruction: "C", skills: [] },
  },
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
  entry: "a",
};

describe("DagRenderer — uniform widths", () => {
  it("renders all boxes with the same width", () => {
    const r = new DagRenderer(unevenWorkflow, { animate: false });
    const output = stripAnsi(r.renderToString());
    const topLines = output.split("\n").filter((l) => l.includes("┌") && l.includes("┐"));
    const widths = topLines.map((l) => l.trim().length);
    expect(new Set(widths).size).toBe(1);
  });

  it("uses ▼ arrowhead on downward connectors", () => {
    const r = new DagRenderer(unevenWorkflow, { animate: false });
    const output = stripAnsi(r.renderToString());
    expect(output).toContain("▼");
  });

  it("uses centered connectors between boxes", () => {
    const r = new DagRenderer(unevenWorkflow, { animate: false });
    const output = stripAnsi(r.renderToString());
    const lines = output.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("▼") && i + 1 < lines.length && lines[i + 1].includes("│")) {
        const arrowCol = lines[i].indexOf("▼");
        // Check the ▼ is within the box boundary
        const nextBoxLine = lines.slice(i).find((l) => l.includes("┌") && l.includes("┐"));
        if (nextBoxLine) {
          const boxStart = nextBoxLine.indexOf("┌");
          const boxEnd = nextBoxLine.indexOf("┐");
          expect(arrowCol).toBeGreaterThanOrEqual(boxStart);
          expect(arrowCol).toBeLessThanOrEqual(boxEnd);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/cli/renderer.test.ts`
Expected: FAIL — boxes have different widths, no `▼` character

- [ ] **Step 3: Rewrite `renderToString()` for uniform widths and clean connectors**

Replace the rendering internals in `packages/core/src/cli/renderer.ts`. Key changes:

1. Pre-compute `boxInnerWidth` from max node name length
2. Replace `renderNodeBox()` with inline rendering that accepts `boxInnerWidth`
3. Add `renderBottomWithConnector(w)` → `└───┬───┘` (centered `┬`)
4. Add `renderTopWithConnector(w)` → `┌───▼───┐` (centered `▼`)
5. Add `renderVerticalConnector(w)` → centered `│`

Replace the `renderNodeBox`, `renderArrow` functions, and the `renderToString()` method body. Here is the complete updated `renderToString()`:

```ts
  renderToString(): string {
    const lines: string[] = [];
    lines.push(`  ${chalk.bold(this.workflow.name)}`);
    lines.push("");

    // Compute uniform box width from longest node name
    const maxNameWidth = Math.max(
      ...this.topoOrder.map((id) => this.workflow.nodes[id]?.name.length ?? 0),
      12,
    );
    const boxInnerWidth = maxNameWidth + 7; // icon(2) + space(1) + name + pad(2) + margins(2)

    for (let i = 0; i < this.topoOrder.length; i++) {
      const nodeId = this.topoOrder[i];
      const node = this.workflow.nodes[nodeId];
      if (!node) continue;

      const state = this.nodeStates.get(nodeId) ?? { state: "pending" as NodeState, toolCallCount: 0 };
      const isFirst = i === 0;
      const isLast = i === this.topoOrder.length - 1;

      // Top border
      if (isFirst) {
        lines.push(`  ┌${"─".repeat(boxInnerWidth)}┐`);
      } else {
        lines.push(renderTopWithConnector(boxInnerWidth));
      }

      // Content
      const icon = statusIcon(state.state);
      let detail = "";
      if (state.state === "running" && state.startedAt != null) {
        detail = chalk.dim(` ${formatElapsed(Date.now() - state.startedAt)}`);
      } else if (state.state === "completed" && state.toolCallCount > 0) {
        detail = chalk.dim(` ${state.toolCallCount} call${state.toolCallCount === 1 ? "" : "s"}`);
      } else if (state.state === "failed" && state.startedAt != null && state.finishedAt != null) {
        detail = chalk.dim(` ${formatElapsed(state.finishedAt - state.startedAt)}`);
      }
      const labelVisible = `${stripAnsi(icon)} ${node.name}${stripAnsi(detail)}`;
      const pad = Math.max(0, boxInnerWidth - labelVisible.length - 2);
      lines.push(`  │ ${icon} ${node.name}${detail}${" ".repeat(pad)} │`);

      // Bottom border
      if (isLast) {
        lines.push(`  └${"─".repeat(boxInnerWidth)}┘`);
      } else {
        lines.push(renderBottomWithConnector(boxInnerWidth));
      }

      // Vertical connector between nodes (not after last)
      if (!isLast) {
        lines.push(renderVerticalConnector(boxInnerWidth));
      }
    }

    lines.push(renderLegend());
    return lines.join("\n");
  }
```

Add these helper functions (replace old `renderNodeBox` and `renderArrow`):

```ts
function renderBottomWithConnector(boxInnerWidth: number): string {
  const center = Math.floor(boxInnerWidth / 2);
  const left = "─".repeat(center);
  const right = "─".repeat(boxInnerWidth - center - 1);
  return `  └${left}┬${right}┘`;
}

function renderTopWithConnector(boxInnerWidth: number): string {
  const center = Math.floor(boxInnerWidth / 2);
  const left = "─".repeat(center);
  const right = "─".repeat(boxInnerWidth - center - 1);
  return `  ┌${left}▼${right}┐`;
}

function renderVerticalConnector(boxInnerWidth: number): string {
  const center = Math.floor(boxInnerWidth / 2) + 3;
  return " ".repeat(center) + "│";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/cli/renderer.test.ts`
Expected: PASS (all existing + 3 new tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/renderer.ts packages/core/src/cli/renderer.test.ts
git commit -m "feat(cli): uniform box widths and clean connectors in DagRenderer"
```

---

### Task 3: DagRenderer — Branching Layout

**Files:**
- Modify: `packages/core/src/cli/renderer.ts`
- Modify: `packages/core/src/cli/renderer.test.ts`

- [ ] **Step 1: Add tests for branching layout**

Add to `packages/core/src/cli/renderer.test.ts`:

```ts
const branchingWorkflow: Workflow = {
  id: "branching",
  name: "Branching Test",
  description: "",
  nodes: {
    gather: { name: "Gather", instruction: "Gather", skills: [] },
    investigate: { name: "Investigate", instruction: "Investigate", skills: [] },
    create_ticket: { name: "Create Ticket", instruction: "Create", skills: [] },
    skip: { name: "Skip", instruction: "Skip", skills: [] },
    notify: { name: "Notify", instruction: "Notify", skills: [] },
  },
  edges: [
    { from: "gather", to: "investigate" },
    { from: "investigate", to: "create_ticket", when: "Real bugs found" },
    { from: "investigate", to: "skip", when: "No bugs" },
    { from: "create_ticket", to: "notify" },
  ],
  entry: "gather",
};

describe("DagRenderer — branching", () => {
  it("renders branching nodes side-by-side", () => {
    const r = new DagRenderer(branchingWorkflow, { animate: false });
    const output = stripAnsi(r.renderToString());
    expect(output).toContain("Create Ticket");
    expect(output).toContain("Skip");
  });

  it("renders fork connector for branching", () => {
    const r = new DagRenderer(branchingWorkflow, { animate: false });
    const output = stripAnsi(r.renderToString());
    expect(output).toContain("┴");
  });

  it("tracks state correctly through branches", () => {
    const r = new DagRenderer(branchingWorkflow, { animate: false });
    r.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    r.update({ type: "node:exit", node: "gather", result: { status: "success", data: {}, toolCalls: [] } });
    r.update({ type: "node:enter", node: "investigate", instruction: "Investigate" });

    expect(r.getNodeState("gather")).toBe("completed");
    expect(r.getNodeState("investigate")).toBe("running");
    expect(r.getNodeState("create_ticket")).toBe("pending");
    expect(r.getNodeState("skip")).toBe("pending");
  });

  it("renders nodes in correct topological order", () => {
    const r = new DagRenderer(branchingWorkflow, { animate: false });
    const output = stripAnsi(r.renderToString());
    const gatherIdx = output.indexOf("Gather");
    const investIdx = output.indexOf("Investigate");
    const notifyIdx = output.indexOf("Notify");
    expect(gatherIdx).toBeLessThan(investIdx);
    expect(investIdx).toBeLessThan(notifyIdx);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/cli/renderer.test.ts`
Expected: FAIL — no fork `┴` character in output

- [ ] **Step 3: Implement branching layout**

The approach: when walking the topological order, detect nodes with >1 outgoing edge. Render their children side-by-side with a fork connector.

Replace `renderToString()` with a layout-aware version. The key additions:

1. Build `children` adjacency map from `workflow.edges`
2. Track `rendered` set to avoid double-rendering branch targets
3. When a node has 2 children, render them side-by-side with a `┌───┴───┐` fork
4. For 3+ children, fall back to sequential vertical rendering

```ts
  renderToString(): string {
    const lines: string[] = [];
    lines.push(`  ${chalk.bold(this.workflow.name)}`);
    lines.push("");

    // Build adjacency
    const childrenMap = new Map<string, string[]>();
    for (const id of Object.keys(this.workflow.nodes)) {
      childrenMap.set(id, []);
    }
    for (const edge of this.workflow.edges) {
      childrenMap.get(edge.from)?.push(edge.to);
    }

    // Compute uniform box width
    const maxNameWidth = Math.max(
      ...Object.values(this.workflow.nodes).map((n) => n.name.length),
      12,
    );
    const boxInnerWidth = maxNameWidth + 7;
    const rendered = new Set<string>();

    const buildContentLine = (nodeId: string, innerWidth: number): string => {
      const node = this.workflow.nodes[nodeId]!;
      const state = this.nodeStates.get(nodeId) ?? { state: "pending" as NodeState, toolCallCount: 0 };
      const icon = statusIcon(state.state);
      let detail = "";
      if (state.state === "running" && state.startedAt != null) {
        detail = chalk.dim(` ${formatElapsed(Date.now() - state.startedAt)}`);
      } else if (state.state === "completed" && state.toolCallCount > 0) {
        detail = chalk.dim(` ${state.toolCallCount} call${state.toolCallCount === 1 ? "" : "s"}`);
      } else if (state.state === "failed" && state.startedAt != null && state.finishedAt != null) {
        detail = chalk.dim(` ${formatElapsed(state.finishedAt - state.startedAt)}`);
      }
      const labelVisible = `${stripAnsi(icon)} ${node.name}${stripAnsi(detail)}`;
      const pad = Math.max(0, innerWidth - labelVisible.length - 2);
      return `│ ${icon} ${node.name}${detail}${" ".repeat(pad)} │`;
    };

    const renderBranchPair = (leftId: string, rightId: string) => {
      rendered.add(leftId);
      rendered.add(rightId);

      // Fork connector: ┌───┴───┐
      const center = Math.floor(boxInnerWidth / 2) + 3; // center of parent box
      const leftBoxCenter = Math.floor((boxInnerWidth + 4) / 2); // center of left box
      const rightBoxStart = boxInnerWidth + 5; // start of right box (left box width + gap)
      const rightBoxCenter = rightBoxStart + Math.floor((boxInnerWidth + 4) / 2);

      // Build the fork line
      const forkWidth = rightBoxCenter + 1;
      const forkChars = new Array(forkWidth).fill(" ");
      // Horizontal bar from left center to right center
      for (let c = leftBoxCenter; c <= rightBoxCenter; c++) {
        forkChars[c] = "─";
      }
      forkChars[center] = "┴"; // center tee under parent
      forkChars[leftBoxCenter] = "┌"; // left branch start
      forkChars[rightBoxCenter] = "┐"; // right branch end
      lines.push(forkChars.join(""));

      // Vertical drops: │ under each branch start
      const dropChars = new Array(forkWidth).fill(" ");
      dropChars[leftBoxCenter] = "│";
      dropChars[rightBoxCenter] = "│";
      lines.push(dropChars.join(""));

      // Side-by-side boxes
      const hLine = "─".repeat(boxInnerWidth);
      const leftContent = buildContentLine(leftId, boxInnerWidth);
      const rightContent = buildContentLine(rightId, boxInnerWidth);

      const leftHasChildren = (childrenMap.get(leftId) ?? []).length > 0;
      const rightHasChildren = (childrenMap.get(rightId) ?? []).length > 0;

      // Top borders with ▼
      lines.push(`  ┌${renderCentered("▼", boxInnerWidth)}┐ ┌${renderCentered("▼", boxInnerWidth)}┐`);
      lines.push(`  ${leftContent} ${rightContent}`);

      // Bottom borders
      const leftBottom = leftHasChildren
        ? `└${renderCentered("┬", boxInnerWidth)}┘`
        : `└${hLine}┘`;
      const rightBottom = rightHasChildren
        ? `└${renderCentered("┬", boxInnerWidth)}┘`
        : `└${hLine}┘`;
      lines.push(`  ${leftBottom} ${rightBottom}`);
    };

    for (const nodeId of this.topoOrder) {
      if (rendered.has(nodeId)) continue;

      const node = this.workflow.nodes[nodeId];
      if (!node) continue;

      const nodeChildren = childrenMap.get(nodeId) ?? [];
      const hasParent = this.workflow.edges.some((e) => e.to === nodeId);
      const hasChildren = nodeChildren.length > 0;

      // Vertical connector from previous node
      if (hasParent) {
        lines.push(renderVerticalConnector(boxInnerWidth));
      }

      // Render the node
      rendered.add(nodeId);
      if (hasParent) {
        lines.push(renderTopWithConnector(boxInnerWidth));
      } else {
        lines.push(`  ┌${"─".repeat(boxInnerWidth)}┐`);
      }

      lines.push(`  ${buildContentLine(nodeId, boxInnerWidth)}`);

      if (hasChildren) {
        lines.push(renderBottomWithConnector(boxInnerWidth));
      } else {
        lines.push(`  └${"─".repeat(boxInnerWidth)}┘`);
      }

      // Handle branching
      if (nodeChildren.length === 2) {
        renderBranchPair(nodeChildren[0], nodeChildren[1]);
      }
      // 3+ branches: sequential fallback (children will be picked up by the main loop)
    }

    lines.push(renderLegend());
    return lines.join("\n");
  }
```

Add helper for centered character in a line:

```ts
function renderCentered(char: string, width: number): string {
  const center = Math.floor(width / 2);
  const left = "─".repeat(center);
  const right = "─".repeat(width - center - 1);
  return `${left}${char}${right}`;
}
```

**Note to implementer:** The exact column math for the fork connector will need adjustment during implementation. The key properties to verify visually:
- Fork `┴` is centered under the parent box's `┬`
- `▼` arrows point into the top-center of each branch box
- Side-by-side boxes have the same inner width as all other boxes
- The output must contain `┴` and both branch node names

If `process.stderr.columns` is defined and the total width of two side-by-side boxes exceeds it, fall back to sequential rendering (render branch targets vertically one after another).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/cli/renderer.test.ts`
Expected: PASS (all tests including branching)

- [ ] **Step 5: Visual verification**

```bash
cd packages/core && npx tsx -e "
import { DagRenderer } from './src/cli/renderer.js';
const w = {
  id: 'test', name: 'Triage Test', description: '', entry: 'gather',
  nodes: {
    gather: { name: 'Gather Context', instruction: '', skills: [] },
    investigate: { name: 'Investigate', instruction: '', skills: [] },
    create_ticket: { name: 'Create Ticket', instruction: '', skills: [] },
    skip: { name: 'Skip', instruction: '', skills: [] },
    notify: { name: 'Notify', instruction: '', skills: [] },
  },
  edges: [
    { from: 'gather', to: 'investigate' },
    { from: 'investigate', to: 'create_ticket', when: 'bugs' },
    { from: 'investigate', to: 'skip', when: 'no bugs' },
    { from: 'create_ticket', to: 'notify' },
  ],
};
const r = new DagRenderer(w);
r.update({ type: 'node:enter', node: 'gather', instruction: '' });
r.update({ type: 'node:exit', node: 'gather', result: { status: 'success', data: {}, toolCalls: [] } });
r.update({ type: 'node:enter', node: 'investigate', instruction: '' });
console.log(r.renderToString());
"
```

Verify the output matches the spec target (vertical flow, `┌───┴───┐` fork, side-by-side branches, `▼` connectors, uniform widths).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/cli/renderer.ts packages/core/src/cli/renderer.test.ts
git commit -m "feat(cli): add branching layout support to DagRenderer"
```

---

### Task 4: CLI `workflow create` Command

**Files:**
- Modify: `packages/core/src/cli/main.ts`

- [ ] **Step 1: Add imports at top of `main.ts`**

Add these imports near the top of the file (around line 20, after the existing imports):

```ts
import { buildWorkflow, refineWorkflow } from "../workflow-builder.js";
import { DagRenderer } from "./renderer.js";
import * as readline from "node:readline";
```

- [ ] **Step 2: Add the `promptUser` helper function**

Add before the `workflowCmd` block (around line 452):

```ts
function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
```

- [ ] **Step 3: Add `workflow create` command**

Add after the existing `workflowCmd.command("export")` action (after line 658):

```ts
workflowCmd
  .command("create <description>")
  .description("Generate a new workflow from a natural language description")
  .option("--json", "Output workflow JSON to stdout (no interactive prompt)")
  .action(async (description: string, options: { json?: boolean }) => {
    const skills = configuredSkills();
    const claude = new ClaudeClient({
      maxTurns: 3,
      cwd: process.cwd(),
      logger: consoleLogger,
    });

    try {
      let workflow = await buildWorkflow(description, { claude, skills, logger: consoleLogger });

      if (options.json) {
        process.stdout.write(JSON.stringify(workflow, null, 2) + "\n");
        process.exit(0);
        return;
      }

      while (true) {
        console.log("");
        const renderer = new DagRenderer(workflow, { animate: false });
        console.log(renderer.renderToString());
        console.log("");

        const defaultPath = `.sweny/workflows/${workflow.id}.yml`;
        const answer = await promptUser(`  Save to ${defaultPath}? [Y/n/refine] `);
        const choice = answer.toLowerCase() || "y";

        if (choice === "y" || choice === "yes") {
          const dir = path.dirname(defaultPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(defaultPath, stringifyYaml(workflow, { indent: 2, lineWidth: 120 }), "utf-8");
          console.log(chalk.green(`\n  Saved to ${defaultPath}\n`));
          process.exit(0);
          return;
        } else if (choice === "n" || choice === "no") {
          console.log(chalk.dim("\n  Discarded.\n"));
          process.exit(0);
          return;
        } else if (choice === "refine" || choice === "r") {
          const refinement = await promptUser("  What would you like to change? ");
          if (!refinement) continue;
          console.log(chalk.dim("\n  Refining...\n"));
          workflow = await refineWorkflow(workflow, refinement, { claude, skills, logger: consoleLogger });
        } else {
          console.log(chalk.dim("\n  Refining...\n"));
          workflow = await refineWorkflow(workflow, choice, { claude, skills, logger: consoleLogger });
        }
      }
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });
```

- [ ] **Step 4: Verify build succeeds**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/main.ts
git commit -m "feat(cli): add 'sweny workflow create' command"
```

---

### Task 5: CLI `workflow edit` Command

**Files:**
- Modify: `packages/core/src/cli/main.ts`

- [ ] **Step 1: Add `workflow edit` command**

Add after the `workflow create` command block:

```ts
workflowCmd
  .command("edit <file> [instruction]")
  .description("Edit an existing workflow file with natural language instructions")
  .option("--json", "Output updated workflow JSON to stdout (no interactive prompt)")
  .action(async (file: string, instruction: string | undefined, options: { json?: boolean }) => {
    let workflow: Workflow;
    try {
      workflow = loadWorkflowFile(file);
    } catch (err) {
      console.error(chalk.red(`  Error loading ${file}: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
      return;
    }

    const skills = configuredSkills();
    const claude = new ClaudeClient({
      maxTurns: 3,
      cwd: process.cwd(),
      logger: consoleLogger,
    });

    if (!instruction) {
      instruction = await promptUser("  What would you like to change? ");
      if (!instruction) {
        console.log(chalk.dim("  No changes.\n"));
        process.exit(0);
        return;
      }
    }

    try {
      let updated = await refineWorkflow(workflow, instruction, { claude, skills, logger: consoleLogger });

      if (options.json) {
        process.stdout.write(JSON.stringify(updated, null, 2) + "\n");
        process.exit(0);
        return;
      }

      while (true) {
        console.log("");
        const renderer = new DagRenderer(updated, { animate: false });
        console.log(renderer.renderToString());
        console.log("");

        const answer = await promptUser(`  Save changes to ${file}? [Y/n/refine] `);
        const choice = answer.toLowerCase() || "y";

        if (choice === "y" || choice === "yes") {
          fs.writeFileSync(file, stringifyYaml(updated, { indent: 2, lineWidth: 120 }), "utf-8");
          console.log(chalk.green(`\n  Saved to ${file}\n`));
          process.exit(0);
          return;
        } else if (choice === "n" || choice === "no") {
          console.log(chalk.dim("\n  Discarded.\n"));
          process.exit(0);
          return;
        } else if (choice === "refine" || choice === "r") {
          const refinement = await promptUser("  What would you like to change? ");
          if (!refinement) continue;
          console.log(chalk.dim("\n  Refining...\n"));
          updated = await refineWorkflow(updated, refinement, { claude, skills, logger: consoleLogger });
        } else {
          console.log(chalk.dim("\n  Refining...\n"));
          updated = await refineWorkflow(updated, choice, { claude, skills, logger: consoleLogger });
        }
      }
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });
```

- [ ] **Step 2: Verify build succeeds**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Verify CLI help shows both new commands**

Run: `cd packages/core && npx tsx src/cli/main.ts workflow --help`
Expected output should list: `create`, `edit`, `run`, `validate`, `export`, `list`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/cli/main.ts
git commit -m "feat(cli): add 'sweny workflow edit' command"
```

---

### Task 6: Full Test Suite + Final Verification

**Files:**
- No new files — verification only

- [ ] **Step 1: Run the full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build the package**

Run: `cd packages/core && npm run build`
Expected: Clean build, `dist/` updated

- [ ] **Step 4: Verify exports**

Run: `cd packages/core && npx tsx -e "import { buildWorkflow, refineWorkflow } from './src/index.js'; console.log(typeof buildWorkflow, typeof refineWorkflow)"`
Expected: `function function`

- [ ] **Step 5: Commit any remaining fixes**

If any issues were found, fix and commit:

```bash
git add -A
git commit -m "fix: resolve test/typecheck issues from workflow builder"
```
