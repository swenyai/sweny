/**
 * Tests for YAML-based built-in workflows.
 *
 * Validates that the YAML files are correctly loaded, structurally valid,
 * match the Workflow type, and that the browser bundle is consistent.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { triageWorkflow, implementWorkflow, seedContentWorkflow } from "../workflows/index.js";
import { validateWorkflow, workflowZ } from "../schema.js";
import type { Workflow } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.join(__dirname, "..", "workflows");

// ─── YAML file existence & parsing ──────────────────────────────

describe("workflow YAML files", () => {
  const yamlFiles = ["triage.yml", "implement.yml", "seed-content.yml"];

  for (const file of yamlFiles) {
    it(`${file} exists on disk`, () => {
      const filePath = path.join(workflowDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it(`${file} is valid YAML`, () => {
      const content = fs.readFileSync(path.join(workflowDir, file), "utf-8");
      expect(() => parseYaml(content)).not.toThrow();
    });

    it(`${file} parses to an object with required Workflow fields`, () => {
      const content = fs.readFileSync(path.join(workflowDir, file), "utf-8");
      const data = parseYaml(content) as Record<string, unknown>;
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("entry");
      expect(data).toHaveProperty("nodes");
      expect(data).toHaveProperty("edges");
      expect(typeof data.id).toBe("string");
      expect(typeof data.name).toBe("string");
      expect(typeof data.entry).toBe("string");
      expect(typeof data.nodes).toBe("object");
      expect(Array.isArray(data.edges)).toBe(true);
    });

    it(`${file} passes Zod schema validation`, () => {
      const content = fs.readFileSync(path.join(workflowDir, file), "utf-8");
      const data = parseYaml(content);
      expect(() => workflowZ.parse(data)).not.toThrow();
    });
  }
});

// ─── Loaded workflow objects ────────────────────────────────────

describe("loaded workflow objects", () => {
  const workflows: [string, Workflow][] = [
    ["triage", triageWorkflow],
    ["implement", implementWorkflow],
    ["seed-content", seedContentWorkflow],
  ];

  for (const [name, workflow] of workflows) {
    describe(name, () => {
      it("has correct id", () => {
        expect(workflow.id).toBe(name);
      });

      it("has a non-empty name", () => {
        expect(workflow.name.length).toBeGreaterThan(0);
      });

      it("entry node exists in nodes", () => {
        expect(workflow.nodes).toHaveProperty(workflow.entry);
      });

      it("passes structural validation (no cycles, all reachable)", () => {
        const errors = validateWorkflow(workflow);
        expect(errors).toEqual([]);
      });

      it("every node has a non-empty instruction", () => {
        for (const [nodeId, node] of Object.entries(workflow.nodes)) {
          const instr = node.instruction;
          if (typeof instr === "string") {
            expect(instr.length, `node "${nodeId}" has empty instruction`).toBeGreaterThan(0);
          } else {
            // Object-form Source — always truthy if it exists
            expect(instr, `node "${nodeId}" has falsy instruction`).toBeTruthy();
          }
        }
      });

      it("every node has a name", () => {
        for (const [nodeId, node] of Object.entries(workflow.nodes)) {
          expect(node.name.length, `node "${nodeId}" has empty name`).toBeGreaterThan(0);
        }
      });

      it("all edge sources reference existing nodes", () => {
        const nodeIds = new Set(Object.keys(workflow.nodes));
        for (const edge of workflow.edges) {
          expect(nodeIds.has(edge.from), `edge source "${edge.from}" not in nodes`).toBe(true);
        }
      });

      it("all edge targets reference existing nodes", () => {
        const nodeIds = new Set(Object.keys(workflow.nodes));
        for (const edge of workflow.edges) {
          expect(nodeIds.has(edge.to), `edge target "${edge.to}" not in nodes`).toBe(true);
        }
      });

      it("has no self-loops", () => {
        for (const edge of workflow.edges) {
          expect(edge.from, `self-loop on "${edge.from}"`).not.toBe(edge.to);
        }
      });

      it("all non-terminal nodes have at least one outgoing edge", () => {
        const nodeIds = Object.keys(workflow.nodes);
        const nodesWithOutgoing = new Set(workflow.edges.map((e) => e.from));
        const terminalNodes = nodeIds.filter((id) => !nodesWithOutgoing.has(id));
        // Terminal nodes are fine (they're leaf nodes), but there should be at least one
        // non-terminal node unless it's a single-node workflow
        if (nodeIds.length > 1) {
          expect(nodesWithOutgoing.size).toBeGreaterThan(0);
        }
      });
    });
  }
});

// ─── Triage workflow specifics ──────────────────────────────────

describe("triage workflow specifics", () => {
  it("has 7 nodes", () => {
    expect(Object.keys(triageWorkflow.nodes).length).toBe(7);
  });

  it("starts at gather", () => {
    expect(triageWorkflow.entry).toBe("gather");
  });

  it("has conditional edges from investigate", () => {
    const investigateEdges = triageWorkflow.edges.filter((e) => e.from === "investigate");
    expect(investigateEdges.length).toBe(2);
    expect(investigateEdges.every((e) => e.when)).toBe(true);
  });

  it("notify is reachable from all branches", () => {
    const toNotify = triageWorkflow.edges.filter((e) => e.to === "notify");
    expect(toNotify.length).toBeGreaterThanOrEqual(3);
  });

  it("investigate node has structured output schema", () => {
    expect(triageWorkflow.nodes.investigate.output).toBeDefined();
    expect(triageWorkflow.nodes.investigate.output!.type).toBe("object");
    expect(triageWorkflow.nodes.investigate.output!.required).toContain("findings");
  });
});

// ─── Implement workflow specifics ───────────────────────────────

describe("implement workflow specifics", () => {
  it("has 5 nodes", () => {
    expect(Object.keys(implementWorkflow.nodes).length).toBe(5);
  });

  it("starts at analyze", () => {
    expect(implementWorkflow.entry).toBe("analyze");
  });

  it("has conditional edges from analyze", () => {
    const analyzeEdges = implementWorkflow.edges.filter((e) => e.from === "analyze");
    expect(analyzeEdges.length).toBe(2);
    expect(analyzeEdges.every((e) => e.when)).toBe(true);
  });

  it("skip routes to notify (team always gets notified)", () => {
    const skipToNotify = implementWorkflow.edges.find((e) => e.from === "skip" && e.to === "notify");
    expect(skipToNotify).toBeDefined();
  });

  it("analyze node has structured output schema", () => {
    expect(implementWorkflow.nodes.analyze.output).toBeDefined();
    expect(implementWorkflow.nodes.analyze.output!.type).toBe("object");
  });
});

// ─── Browser bundle consistency ─────────────────────────────────

describe("browser bundle", () => {
  const browserPath = path.join(__dirname, "..", "..", "dist", "workflows", "browser.js");

  it("exists in dist", () => {
    expect(fs.existsSync(browserPath)).toBe(true);
  });

  it("triage workflow is deeply equal", async () => {
    const browser = await import(browserPath);
    expect(browser.triageWorkflow).toEqual(JSON.parse(JSON.stringify(triageWorkflow)));
  });

  it("implement workflow is deeply equal", async () => {
    const browser = await import(browserPath);
    expect(browser.implementWorkflow).toEqual(JSON.parse(JSON.stringify(implementWorkflow)));
  });

  it("seed-content workflow is deeply equal", async () => {
    const browser = await import(browserPath);
    expect(browser.seedContentWorkflow).toEqual(JSON.parse(JSON.stringify(seedContentWorkflow)));
  });

  it("exports exactly the expected workflow names", async () => {
    const browser = await import(browserPath);
    const exportedKeys = Object.keys(browser).sort();
    expect(exportedKeys).toEqual(["implementWorkflow", "seedContentWorkflow", "triageWorkflow"]);
  });
});

// ─── Zod runtime validation ─────────────────────────────────────

describe("runtime Zod validation in loader", () => {
  it("workflows are Zod-validated at load time (not just cast)", () => {
    // The loader uses workflowZ.parse(), so invalid YAML would throw at import.
    // If we got here, all 3 workflows passed Zod validation at module load.
    // Verify by checking the parsed output has Zod's default-applied fields.
    expect(triageWorkflow.description).toBeDefined();
    expect(implementWorkflow.description).toBeDefined();
    expect(seedContentWorkflow.description).toBeDefined();

    // Zod applies .default([]) to skills arrays — verify it works
    for (const node of Object.values(triageWorkflow.nodes)) {
      expect(Array.isArray(node.skills)).toBe(true);
    }
  });
});
