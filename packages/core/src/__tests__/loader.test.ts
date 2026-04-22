import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadAndValidateWorkflow } from "../loader.js";

function makeTempFile(name: string, content: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sweny-loader-test-"));
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const VALID_YAML = `
id: demo
name: Demo
description: d
entry: a
nodes:
  a:
    name: A
    instruction: do a
    skills: []
edges: []
`;

describe("loadAndValidateWorkflow", () => {
  it("loads a valid YAML workflow", () => {
    const f = makeTempFile("wf.yml", VALID_YAML);
    try {
      const result = loadAndValidateWorkflow(f.path);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.workflow.id).toBe("demo");
        expect(result.workflow.nodes.a.name).toBe("A");
      }
    } finally {
      f.cleanup();
    }
  });

  it("loads a valid JSON workflow", () => {
    const f = makeTempFile(
      "wf.json",
      JSON.stringify({
        id: "j",
        name: "J",
        entry: "a",
        nodes: { a: { name: "A", instruction: "x", skills: [] } },
        edges: [],
      }),
    );
    try {
      const result = loadAndValidateWorkflow(f.path);
      expect(result.ok).toBe(true);
    } finally {
      f.cleanup();
    }
  });

  it("rejects a missing file cleanly", () => {
    const result = loadAndValidateWorkflow("/nonexistent/does-not-exist.yml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /read|ENOENT|not found/i.test(e.message))).toBe(true);
    }
  });

  it("rejects malformed YAML with a parse error", () => {
    const f = makeTempFile("broken.yml", "id: x\nnodes:\n  a:\n    name: [unclosed");
    try {
      const result = loadAndValidateWorkflow(f.path);
      expect(result.ok).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  it("rejects a workflow that fails Zod (missing required field)", () => {
    // Missing `entry`.
    const f = makeTempFile(
      "bad.yml",
      `id: x
name: X
nodes:
  a: { name: A, instruction: x, skills: [] }
edges: []
`,
    );
    try {
      const result = loadAndValidateWorkflow(f.path);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => /entry/i.test(e.message))).toBe(true);
      }
    } finally {
      f.cleanup();
    }
  });

  it("rejects a workflow with wrong field type (nodes as string)", () => {
    const f = makeTempFile("bad.yml", `id: x\nname: X\nentry: a\nnodes: "not an object"\nedges: []\n`);
    try {
      const result = loadAndValidateWorkflow(f.path);
      expect(result.ok).toBe(false);
      // Must NOT crash — the old path called `validateWorkflow` directly on
      // raw data and would try to iterate a string like an object.
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    } finally {
      f.cleanup();
    }
  });

  it("rejects a workflow with a self-loop lacking max_iterations (structural)", () => {
    const f = makeTempFile(
      "selfloop.yml",
      `id: x
name: X
entry: a
nodes:
  a: { name: A, instruction: x, skills: [] }
edges:
  - { from: a, to: a }
`,
    );
    try {
      const result = loadAndValidateWorkflow(f.path);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.code === "SELF_LOOP")).toBe(true);
      }
    } finally {
      f.cleanup();
    }
  });

  it("accepts a self-loop with max_iterations (bounded)", () => {
    const f = makeTempFile(
      "bounded.yml",
      `id: x
name: X
entry: a
nodes:
  a: { name: A, instruction: x, skills: [] }
edges:
  - { from: a, to: a, max_iterations: 3 }
`,
    );
    try {
      const result = loadAndValidateWorkflow(f.path);
      expect(result.ok).toBe(true);
    } finally {
      f.cleanup();
    }
  });

  it("rejects malformed inline skills", () => {
    // Inline skill with neither instruction nor mcp — Zod refine should catch it.
    const f = makeTempFile(
      "inline.yml",
      `id: x
name: X
entry: a
nodes:
  a: { name: A, instruction: x, skills: [custom] }
edges: []
skills:
  custom:
    name: Custom
    description: empty
`,
    );
    try {
      const result = loadAndValidateWorkflow(f.path);
      expect(result.ok).toBe(false);
    } finally {
      f.cleanup();
    }
  });
});
