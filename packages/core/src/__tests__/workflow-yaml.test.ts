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

// ─── Triage `implement` node contract ───────────────────────────
//
// The implement node is the one that ships code. Its instruction text and
// verify gate are what stops the agent from shipping a fix without tests.
// Regressions here are silent and expensive — a fix lands on main without
// coverage and the agent's quality bar quietly drops. So pin every load-
// bearing piece of the contract: instruction shape, output schema, verify
// rule, retry block. Includes one explicit "known limitation" test that
// documents the pass-with-empty-tests escape hole so a future fix doesn't
// quietly close it without us noticing.

describe("triage implement node — fix-quality contract", () => {
  const node = triageWorkflow.nodes.implement;

  describe("instruction text", () => {
    const instruction = node.instruction as string;

    it("is a string source (not an external file ref)", () => {
      // Inline instruction is intentional — keeps the contract auditable
      // in this test file via simple substring assertions.
      expect(typeof instruction).toBe("string");
    });

    it("declares a Quality Bar covering the five Nate requirements", () => {
      // Each axis in the Quality Bar maps to a value in the user's
      // directive: correctness, completeness, industry-standard, no hacky
      // shortcuts, well-tested. A fix that drops any one is incomplete.
      expect(instruction).toMatch(/Quality bar/i);
      expect(instruction).toMatch(/Correctness/);
      expect(instruction).toMatch(/Completeness/);
      expect(instruction).toMatch(/Idiomatic/);
      expect(instruction).toMatch(/No hacky shortcuts/);
      expect(instruction).toMatch(/Well-tested/);
    });

    it("requires reading the nearest existing test file before writing tests", () => {
      // Without this the agent picks an arbitrary test framework /
      // mocking style that diverges from the repo's conventions, which
      // is the most common form of "test exists but doesn't fit."
      expect(instruction).toMatch(/nearest existing test file/);
    });

    it("requires tests that would fail on the unfixed code", () => {
      // A test that passes both before AND after the fix is decoration,
      // not a regression guard. This is the load-bearing distinction
      // between "wrote tests" and "wrote regression coverage."
      expect(instruction).toMatch(/fail on the unfixed code/i);
    });

    it("requires tests that assert the user-facing contract, not implementation detail", () => {
      expect(instruction).toMatch(/user-facing contract/);
    });

    it("frames idiom examples as illustrations (multiple stacks, not a single dictate)", () => {
      // Earlier draft (PR #168) cited NestJS exception subclasses as if they
      // were the rule. That biased the agent toward web-backend stacks. The
      // softened version (PR #169) shows NestJS, Go, and TypeScript as
      // equal-weight illustrations. Lock that in so a future revision
      // doesn't accidentally narrow the framing again.
      expect(instruction).toMatch(/NestJS/);
      expect(instruction).toMatch(/Go/);
      expect(instruction).toMatch(/TypeScript/);
      expect(instruction).toMatch(/illustrations/i);
      // YAML `|-` block scalar preserves newlines mid-sentence, so allow
      // whitespace (including \n + indent) inside the phrase.
      expect(instruction).toMatch(/whatever the repo already does,\s+keep doing/i);
    });
  });

  describe("output schema", () => {
    const output = node.output;

    it("declares an object schema", () => {
      expect(output).toBeDefined();
      expect(output!.type).toBe("object");
    });

    it("requires the fix-tracking fields the verify gate depends on", () => {
      const required = output!.required as string[];
      // These are the fields the agent MUST report. Removing any of them
      // breaks the verify contract or makes audit impossible.
      expect(required).toContain("branch");
      expect(required).toContain("commit_sha");
      expect(required).toContain("files_changed");
      expect(required).toContain("test_files_changed");
      expect(required).toContain("test_status");
    });

    it("declares test_status with exactly the four allowed values", () => {
      const props = output!.properties as Record<string, any>;
      expect(props.test_status).toBeDefined();
      // Order doesn't matter; set semantics for the enum.
      expect(new Set(props.test_status.enum)).toEqual(new Set(["pass", "fail", "no-framework", "not-run"]));
    });

    it("declares test_files_changed as an array of strings", () => {
      const props = output!.properties as Record<string, any>;
      expect(props.test_files_changed.type).toBe("array");
      expect(props.test_files_changed.items.type).toBe("string");
    });
  });

  describe("verify gate", () => {
    const verify = node.verify;

    it("uses output_matches on test_status", () => {
      expect(verify).toBeDefined();
      expect(verify!.output_matches).toBeDefined();
      const match = verify!.output_matches!.find((m) => m.path === "test_status");
      expect(match).toBeDefined();
    });

    it("allows pass and no-framework, and only those two", () => {
      const match = verify!.output_matches!.find((m) => m.path === "test_status")!;
      // Behavior contract: pass is the happy path; no-framework is the
      // documented escape valve for genuinely test-less repos. Anything
      // else (fail, not-run) trips the gate and triggers retry.
      expect(new Set(match.in as string[])).toEqual(new Set(["pass", "no-framework"]));
    });
  });

  describe("retry block", () => {
    const retry = node.retry;

    it("is configured with max=1 and auto reflection", () => {
      // One retry is the right shape: enough to recover from an honest
      // forget-the-tests, not so many that we burn a whole turn budget
      // on an agent that's already off the rails.
      expect(retry).toBeDefined();
      expect(retry!.max).toBe(1);
      expect(retry!.instruction).toEqual({ auto: true });
    });
  });

  describe("known limitation: pass + empty test_files_changed", () => {
    // This test documents a real enforcement gap, NOT desired behavior.
    //
    // The contract we want is: if test_status is "pass", test_files_changed
    // MUST be non-empty. Verify cannot express "A AND (B implies C)"
    // declaratively (no OR / conditional). The schema's `required` list
    // only checks PRESENCE of the field, not that the array is non-empty.
    //
    // So today an agent that returns { test_status: "pass",
    // test_files_changed: [] } passes verify, even though the instruction
    // text explicitly says that combination is a lie. This test pins the
    // current state and will need to be inverted (with the gap actually
    // closed) when we fix this — most likely via JSON Schema if/then/else
    // in the output, or via routing edges that branch on tests-absent vs
    // tests-present after implement.
    it("currently passes verify (the hole) — instruction prose is the only push-back", () => {
      const verify = node.verify!;
      const testStatusMatch = verify.output_matches!.find((m) => m.path === "test_status")!;
      const allowedStatuses = testStatusMatch.in as string[];

      // The hole: `pass` clears the gate without any verify-time check
      // on the test_files_changed array.
      expect(allowedStatuses).toContain("pass");

      // No verify rule asserts test_files_changed is non-empty when status
      // is pass. If a future contributor adds one (e.g. via output_required
      // with the any: prefix on test_files_changed[*]), this assertion
      // will fail and they'll know to update / remove this gap-test.
      const checksTestFilesNonEmpty =
        (verify.output_required ?? []).some((p) => p.includes("test_files_changed")) ||
        (verify.output_matches ?? []).some((m) => m.path.includes("test_files_changed"));
      expect(checksTestFilesNonEmpty).toBe(false);
    });
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
