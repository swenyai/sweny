/**
 * Rules / Context Cascade + max_turns Tests
 *
 * Covers the spec sections:
 * - Workflow > Rules & Context
 * - Workflow > Runtime Input (rules/context)
 * - Nodes > Max Turns Semantics
 * - Nodes > Rules & Context (cascade + `only` flag)
 * - Nodes > Input Augmentation (assembly order)
 */

import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { execute } from "../executor.js";
import { nodeZ, workflowZ, parseWorkflow, workflowJsonSchema } from "../schema.js";
import type { Workflow, Claude, NodeResult } from "../types.js";
import { createSkillMap } from "../skills/index.js";

// ─── Helpers ────────────────────────────────────────────────────

function freshDir(tag: string): string {
  const dir = path.join(tmpdir(), `sweny-cascade-${tag}-${Date.now()}-${randomBytes(4).toString("hex")}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Minimal Claude that records every run() call for assertion. */
function recordingClaude(defaultData: Record<string, unknown> = {}): {
  claude: Claude;
  runs: { instruction: string; maxTurns: number | undefined }[];
} {
  const runs: { instruction: string; maxTurns: number | undefined }[] = [];
  const claude: Claude = {
    async run(opts): Promise<NodeResult> {
      runs.push({ instruction: opts.instruction, maxTurns: opts.maxTurns });
      return { status: "success", data: defaultData, toolCalls: [] };
    },
    async evaluate(opts) {
      return opts.choices[0].id;
    },
  };
  return { claude, runs };
}

function singleNodeWorkflow(
  overrides: Partial<Workflow["nodes"]["a"]> & { instruction?: Workflow["nodes"]["a"]["instruction"] } = {},
  workflowOverrides: Partial<Workflow> = {},
): Workflow {
  return {
    id: "t",
    name: "T",
    description: "",
    entry: "a",
    edges: [],
    nodes: {
      a: {
        name: "A",
        instruction: overrides.instruction ?? "Base instruction.",
        skills: overrides.skills ?? [],
        ...overrides,
      },
    },
    ...workflowOverrides,
  };
}

// ─── max_turns ──────────────────────────────────────────────────

describe("spec: node.max_turns", () => {
  it("passes max_turns to claude.run when set on the node", async () => {
    const { claude, runs } = recordingClaude();
    const w = singleNodeWorkflow({ instruction: "Do A.", max_turns: 7 });

    await execute(w, {}, { skills: createSkillMap([]), claude });

    expect(runs).toHaveLength(1);
    expect(runs[0].maxTurns).toBe(7);
  });

  it("passes undefined when max_turns is absent (executor defers to Claude default)", async () => {
    const { claude, runs } = recordingClaude();
    const w = singleNodeWorkflow({ instruction: "Do A." });

    await execute(w, {}, { skills: createSkillMap([]), claude });

    expect(runs).toHaveLength(1);
    expect(runs[0].maxTurns).toBeUndefined();
  });

  it("Zod schema accepts positive integers and rejects 0 / negatives / floats", () => {
    expect(() => nodeZ.parse({ name: "X", instruction: "Go.", max_turns: 5 })).not.toThrow();
    expect(() => nodeZ.parse({ name: "X", instruction: "Go." })).not.toThrow();
    expect(() => nodeZ.parse({ name: "X", instruction: "Go.", max_turns: 0 })).toThrow();
    expect(() => nodeZ.parse({ name: "X", instruction: "Go.", max_turns: -3 })).toThrow();
    expect(() => nodeZ.parse({ name: "X", instruction: "Go.", max_turns: 1.5 })).toThrow();
  });
});

// ─── Zod parsing for rules/context ──────────────────────────────

describe("spec: Zod parsing of rules/context", () => {
  it("accepts top-level workflow rules/context as Source arrays", () => {
    const w = parseWorkflow({
      id: "wf",
      name: "Wf",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Go." } },
      edges: [],
      rules: ["Never break API.", { file: "./rules.md" }, { url: "https://x.test/r.md" }],
      context: ["Prod is degraded."],
    });
    expect(w.rules).toHaveLength(3);
    expect(w.context).toEqual(["Prod is degraded."]);
  });

  it("accepts per-node rules in additive (array) form", () => {
    const node = nodeZ.parse({
      name: "N",
      instruction: "Go.",
      rules: ["Rule 1", { inline: "Rule 2" }],
    });
    expect(Array.isArray(node.rules)).toBe(true);
    expect(node.rules).toHaveLength(2);
  });

  it("accepts per-node rules in object form with `only`", () => {
    const node = nodeZ.parse({
      name: "N",
      instruction: "Go.",
      rules: { only: true, sources: ["Only this rule."] },
    });
    expect(node.rules).toEqual({ only: true, sources: ["Only this rule."] });
  });

  it("accepts object form without `only` (equivalent to additive)", () => {
    const node = nodeZ.parse({
      name: "N",
      instruction: "Go.",
      context: { sources: ["Background."] },
    });
    expect(node.context).toEqual({ sources: ["Background."] });
  });

  it("rejects object form without `sources`", () => {
    expect(() => nodeZ.parse({ name: "N", instruction: "Go.", rules: { only: true } })).toThrow();
  });

  it("workflowZ round-trips rules/context through parse", () => {
    const raw = {
      id: "wf",
      name: "Wf",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Go.",
          rules: ["N-rule"],
          context: { only: true, sources: ["N-ctx-only"] },
        },
      },
      edges: [],
      rules: ["W-rule"],
      context: ["W-ctx"],
    };
    const w = workflowZ.parse(raw);
    expect(w.rules).toEqual(["W-rule"]);
    expect(w.context).toEqual(["W-ctx"]);
    expect(w.nodes.a.rules).toEqual(["N-rule"]);
    expect(w.nodes.a.context).toEqual({ only: true, sources: ["N-ctx-only"] });
  });
});

// ─── Exported JSON Schema ───────────────────────────────────────

describe("spec: workflowJsonSchema exports rules/context", () => {
  it("declares workflow-level rules/context as Source arrays", () => {
    const props = workflowJsonSchema.properties;
    expect(props.rules).toMatchObject({ type: "array" });
    expect(props.context).toMatchObject({ type: "array" });
  });

  it("declares per-node rules/context using NodeSources $defs", () => {
    const nodeProps = workflowJsonSchema.properties.nodes.additionalProperties.properties;
    expect(nodeProps.rules).toMatchObject({ $ref: "#/$defs/NodeSources" });
    expect(nodeProps.context).toMatchObject({ $ref: "#/$defs/NodeSources" });
    expect(workflowJsonSchema.$defs.NodeSources).toBeDefined();
  });

  it("NodeSources accepts either array or object-with-sources", () => {
    const ns = workflowJsonSchema.$defs.NodeSources as unknown as { oneOf: unknown[] };
    expect(ns.oneOf).toHaveLength(2);
  });

  it("declares per-node max_turns as integer >= 1", () => {
    const nodeProps = workflowJsonSchema.properties.nodes.additionalProperties.properties;
    expect(nodeProps.max_turns).toMatchObject({ type: "integer", minimum: 1 });
  });
});

// ─── Cascade resolution in executor ─────────────────────────────

describe("spec: rules/context cascade resolution", () => {
  it("base instruction only when no rules/context anywhere", async () => {
    const { claude, runs } = recordingClaude();
    const w = singleNodeWorkflow({ instruction: "JUST_THE_BASE" });

    await execute(w, {}, { skills: createSkillMap([]), claude });

    expect(runs[0].instruction).toBe("JUST_THE_BASE");
    expect(runs[0].instruction).not.toContain("## Rules");
    expect(runs[0].instruction).not.toContain("## Background Context");
  });

  it("workflow-level rules are prepended with the canonical heading", async () => {
    const { claude, runs } = recordingClaude();
    const w = singleNodeWorkflow({ instruction: "Do A." }, { rules: ["Never break API."] });

    await execute(w, {}, { skills: createSkillMap([]), claude });

    expect(runs[0].instruction).toContain("## Rules — You MUST Follow These");
    expect(runs[0].instruction).toContain("Never break API.");
    expect(runs[0].instruction).toContain("Do A.");
  });

  it("workflow-level context is prepended with the canonical heading", async () => {
    const { claude, runs } = recordingClaude();
    const w = singleNodeWorkflow({ instruction: "Do A." }, { context: ["Prod is down."] });

    await execute(w, {}, { skills: createSkillMap([]), claude });

    expect(runs[0].instruction).toContain("## Background Context");
    expect(runs[0].instruction).toContain("Prod is down.");
  });

  it("per-node rules (array form) are additive — both workflow and node rules appear", async () => {
    const { claude, runs } = recordingClaude();
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [],
      rules: ["WORKFLOW_RULE"],
      nodes: {
        a: { name: "A", instruction: "base", skills: [], rules: ["NODE_RULE"] },
      },
    };

    await execute(w, {}, { skills: createSkillMap([]), claude });

    const instr = runs[0].instruction;
    expect(instr).toContain("WORKFLOW_RULE");
    expect(instr).toContain("NODE_RULE");
    // Order: workflow rules appear before node rules
    expect(instr.indexOf("WORKFLOW_RULE")).toBeLessThan(instr.indexOf("NODE_RULE"));
  });

  it("per-node rules with `only: true` blocks the cascade for rules", async () => {
    const { claude, runs } = recordingClaude();
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [],
      rules: ["WORKFLOW_RULE"],
      nodes: {
        a: {
          name: "A",
          instruction: "base",
          skills: [],
          rules: { only: true, sources: ["OVERRIDE_RULE"] },
        },
      },
    };

    await execute(w, {}, { skills: createSkillMap([]), claude });

    const instr = runs[0].instruction;
    expect(instr).toContain("OVERRIDE_RULE");
    expect(instr).not.toContain("WORKFLOW_RULE");
  });

  it("`only: true` on rules does NOT block context cascade", async () => {
    const { claude, runs } = recordingClaude();
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [],
      rules: ["WORKFLOW_RULE"],
      context: ["WORKFLOW_CTX"],
      nodes: {
        a: {
          name: "A",
          instruction: "base",
          skills: [],
          rules: { only: true, sources: ["NODE_RULE"] },
          // No node-level context override → inherits normally
        },
      },
    };

    await execute(w, {}, { skills: createSkillMap([]), claude });

    const instr = runs[0].instruction;
    expect(instr).not.toContain("WORKFLOW_RULE");
    expect(instr).toContain("NODE_RULE");
    expect(instr).toContain("WORKFLOW_CTX"); // context still cascades
  });

  it("runtime input + workflow + node rules concatenate in order", async () => {
    const { claude, runs } = recordingClaude();
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [],
      rules: ["WORKFLOW_RULE"],
      nodes: {
        a: { name: "A", instruction: "base", skills: [], rules: ["NODE_RULE"] },
      },
    };

    await execute(w, { rules: ["INPUT_RULE"] }, { skills: createSkillMap([]), claude });

    const instr = runs[0].instruction;
    const inp = instr.indexOf("INPUT_RULE");
    const wfl = instr.indexOf("WORKFLOW_RULE");
    const nd = instr.indexOf("NODE_RULE");
    expect(inp).toBeGreaterThanOrEqual(0);
    expect(wfl).toBeGreaterThan(inp);
    expect(nd).toBeGreaterThan(wfl);
  });

  it("accepts runtime input rules as a bare string (classified as inline Source)", async () => {
    const { claude, runs } = recordingClaude();
    const w = singleNodeWorkflow({ instruction: "base" });

    await execute(w, { rules: "SINGLE_STRING_RULE" }, { skills: createSkillMap([]), claude });

    expect(runs[0].instruction).toContain("SINGLE_STRING_RULE");
    expect(runs[0].instruction).toContain("## Rules — You MUST Follow These");
  });

  it("accepts runtime input rules as a tagged object source", async () => {
    const { claude, runs } = recordingClaude();
    const w = singleNodeWorkflow({ instruction: "base" });

    await execute(w, { rules: { inline: "TAGGED_RULE" } }, { skills: createSkillMap([]), claude });

    expect(runs[0].instruction).toContain("TAGGED_RULE");
  });

  it("resolves file sources in workflow.rules and records them in trace.sources", async () => {
    const dir = freshDir("file-rules");
    writeFileSync(path.join(dir, "rules.md"), "RULES_FROM_FILE");

    const { claude, runs } = recordingClaude();
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [],
      rules: [{ file: "./rules.md" }],
      nodes: { a: { name: "A", instruction: "base", skills: [] } },
    };

    const result = await execute(w, {}, { skills: createSkillMap([]), claude, cwd: dir });

    expect(runs[0].instruction).toContain("RULES_FROM_FILE");
    expect(result.trace.sources["workflow.rules.0"]).toBeDefined();
    expect(result.trace.sources["workflow.rules.0"].kind).toBe("file");
    expect(result.trace.sources["workflow.rules.0"].hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("resolves node-level rules/context file sources and records them under correct trace keys", async () => {
    const dir = freshDir("node-cascade");
    writeFileSync(path.join(dir, "n-rules.md"), "N_RULES_FILE");
    writeFileSync(path.join(dir, "n-ctx.md"), "N_CTX_FILE");

    const { claude, runs } = recordingClaude();
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [],
      nodes: {
        a: {
          name: "A",
          instruction: "base",
          skills: [],
          rules: [{ file: "./n-rules.md" }],
          context: [{ file: "./n-ctx.md" }],
        },
      },
    };

    const result = await execute(w, {}, { skills: createSkillMap([]), claude, cwd: dir });

    expect(runs[0].instruction).toContain("N_RULES_FILE");
    expect(runs[0].instruction).toContain("N_CTX_FILE");
    expect(result.trace.sources["nodes.a.rules.0"]).toBeDefined();
    expect(result.trace.sources["nodes.a.context.0"]).toBeDefined();
    expect(result.trace.sources["nodes.a.rules.0"].kind).toBe("file");
    expect(result.trace.sources["nodes.a.context.0"].kind).toBe("file");
  });

  it("different nodes in the same workflow see different effective cascades", async () => {
    const { claude, runs } = recordingClaude();
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [{ from: "a", to: "b" }],
      rules: ["WORKFLOW_RULE"],
      nodes: {
        a: {
          name: "A",
          instruction: "Node A base",
          skills: [],
          rules: { only: true, sources: ["A_ONLY"] },
        },
        b: {
          name: "B",
          instruction: "Node B base",
          skills: [],
          rules: ["B_ADDITIVE"],
        },
      },
    };

    await execute(w, {}, { skills: createSkillMap([]), claude });

    const aInstr = runs.find((r) => r.instruction.includes("Node A base"))!.instruction;
    const bInstr = runs.find((r) => r.instruction.includes("Node B base"))!.instruction;

    expect(aInstr).toContain("A_ONLY");
    expect(aInstr).not.toContain("WORKFLOW_RULE");

    expect(bInstr).toContain("WORKFLOW_RULE");
    expect(bInstr).toContain("B_ADDITIVE");
  });

  it("sections are separated by `---` in assembly order: rules → context → skill → base", async () => {
    const { claude, runs } = recordingClaude();
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [],
      rules: ["R"],
      context: ["C"],
      nodes: {
        a: { name: "A", instruction: "BASE", skills: ["rubric"] },
      },
    };

    const rubric = {
      id: "rubric",
      name: "Rubric",
      description: "",
      category: "general" as const,
      config: {},
      tools: [],
      instruction: "SCORE_IT",
    };

    await execute(w, {}, { skills: createSkillMap([rubric]), claude });

    const instr = runs[0].instruction;
    const rIdx = instr.indexOf("## Rules — You MUST Follow These");
    const cIdx = instr.indexOf("## Background Context");
    const sIdx = instr.indexOf("## Skill: Rubric");
    const bIdx = instr.indexOf("BASE");

    expect(rIdx).toBeGreaterThanOrEqual(0);
    expect(cIdx).toBeGreaterThan(rIdx);
    expect(sIdx).toBeGreaterThan(cIdx);
    expect(bIdx).toBeGreaterThan(sIdx);
  });

  it("empty arrays produce no rules/context sections", async () => {
    const { claude, runs } = recordingClaude();
    const w: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [],
      rules: [],
      context: [],
      nodes: {
        a: { name: "A", instruction: "BASE", skills: [], rules: [], context: [] },
      },
    };

    await execute(w, {}, { skills: createSkillMap([]), claude });

    expect(runs[0].instruction).toBe("BASE");
  });
});

// ─── Legacy input.additionalContext compatibility ───────────────

describe("backward compat: input.additionalContext", () => {
  it("still renders under the legacy heading when no rules/context are present", async () => {
    const { claude, runs } = recordingClaude();
    const w = singleNodeWorkflow({ instruction: "base" });

    await execute(w, { additionalContext: "LEGACY_TEXT" }, { skills: createSkillMap([]), claude });

    expect(runs[0].instruction).toContain("## Additional Context & Rules");
    expect(runs[0].instruction).toContain("LEGACY_TEXT");
  });

  it("is suppressed once rules or context are present (rules/context take priority)", async () => {
    const { claude, runs } = recordingClaude();
    const w = singleNodeWorkflow({ instruction: "base" }, { rules: ["NEW_RULE"] });

    await execute(w, { additionalContext: "LEGACY_TEXT" }, { skills: createSkillMap([]), claude });

    expect(runs[0].instruction).toContain("NEW_RULE");
    expect(runs[0].instruction).not.toContain("LEGACY_TEXT");
    expect(runs[0].instruction).not.toContain("## Additional Context & Rules");
  });
});
