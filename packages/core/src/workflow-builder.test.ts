import { describe, it, expect } from "vitest";
import { buildWorkflow, refineWorkflow } from "./workflow-builder.js";
import type { BuildWorkflowOptions } from "./workflow-builder.js";
import { MockClaude } from "./testing.js";
import type { Skill, Workflow } from "./types.js";

// ─── Test fixtures ────────────────────────────────────────────────

const mockSkill: Skill = {
  id: "github",
  name: "GitHub",
  description: "Interact with GitHub repositories and pull requests",
  category: "git",
  config: {},
  tools: [],
};

const validWorkflow: Workflow = {
  id: "triage-errors",
  name: "Triage Errors",
  description: "Queries Sentry for errors and creates a ticket",
  entry: "gather",
  nodes: {
    gather: {
      name: "Gather Errors",
      instruction:
        "Query Sentry for unresolved errors from the last 24 hours. Group by fingerprint. Return top 10 by frequency.",
      skills: ["github"],
    },
    report: {
      name: "Report",
      instruction: "Summarize the gathered errors and output a final report.",
      skills: [],
    },
  },
  edges: [{ from: "gather", to: "report" }],
};

// ─── buildWorkflow ────────────────────────────────────────────────

describe("buildWorkflow", () => {
  it("returns a validated Workflow when Claude produces valid output", async () => {
    const claude = new MockClaude({
      responses: {
        build: { data: { ...validWorkflow } },
      },
    });

    const opts: BuildWorkflowOptions = { claude, skills: [mockSkill] };
    const result = await buildWorkflow("Triage Sentry errors", opts);

    expect(result.id).toBe("triage-errors");
    expect(result.entry).toBe("gather");
    expect(Object.keys(result.nodes)).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it("throws when Claude produces invalid output (missing entry)", async () => {
    const badWorkflow = { ...validWorkflow, entry: "nonexistent-node" };
    const claude = new MockClaude({
      responses: {
        build: { data: { ...badWorkflow } },
      },
    });

    const opts: BuildWorkflowOptions = { claude, skills: [mockSkill] };
    await expect(buildWorkflow("Triage Sentry errors", opts)).rejects.toThrow();
  });

  it("throws when Claude returns empty data", async () => {
    const claude = new MockClaude({
      responses: {
        build: { data: {} },
      },
    });

    const opts: BuildWorkflowOptions = { claude, skills: [mockSkill] };
    await expect(buildWorkflow("Triage Sentry errors", opts)).rejects.toThrow();
  });

  it("includes skill descriptions in the prompt context", async () => {
    let capturedInstruction = "";
    const capturingClaude: import("./types.js").Claude = {
      async run(opts) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: { ...validWorkflow }, toolCalls: [] };
      },
      async evaluate() {
        return "";
      },
      async ask() {
        return "";
      },
    };

    const opts: BuildWorkflowOptions = { claude: capturingClaude, skills: [mockSkill] };
    await buildWorkflow("Triage Sentry errors", opts);

    expect(capturedInstruction).toContain("github");
    expect(capturedInstruction).toContain("Interact with GitHub repositories");
  });
});

// ─── refineWorkflow ───────────────────────────────────────────────

describe("refineWorkflow", () => {
  it("returns a modified workflow", async () => {
    const refinedWorkflow: Workflow = {
      ...validWorkflow,
      id: "triage-errors-refined",
      name: "Triage Errors (Refined)",
    };

    const claude = new MockClaude({
      responses: {
        refine: { data: { ...refinedWorkflow } },
      },
    });

    const opts: BuildWorkflowOptions = { claude, skills: [mockSkill] };
    const result = await refineWorkflow(validWorkflow, "Add a node that creates a Linear ticket", opts);

    expect(result.id).toBe("triage-errors-refined");
    expect(result.name).toBe("Triage Errors (Refined)");
  });

  it("includes the current workflow in the prompt", async () => {
    let capturedInstruction = "";
    const capturingClaude: import("./types.js").Claude = {
      async run(opts) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: { ...validWorkflow }, toolCalls: [] };
      },
      async evaluate() {
        return "";
      },
      async ask() {
        return "";
      },
    };

    const opts: BuildWorkflowOptions = { claude: capturingClaude, skills: [mockSkill] };
    await refineWorkflow(validWorkflow, "Add a notification node", opts);

    expect(capturedInstruction).toContain("triage-errors");
    expect(capturedInstruction).toContain("gather");
  });
});
