import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as core from "../index.js";
import * as browser from "../browser.js";

// Issue #213: complete the public API surface. These tests pin the new
// exports so a future refactor can't silently drop them from `index.ts`.

describe("public API surface (issue #213)", () => {
  it("exports the loader pipeline as values", () => {
    expect(typeof core.loadAndValidateWorkflow).toBe("function");
    expect(typeof core.validateParsed).toBe("function");
  });

  it("exports the runtime enum constants + skill-id helpers", () => {
    expect(core.EVALUATOR_KINDS).toBeDefined();
    expect(core.EVAL_POLICIES).toBeDefined();
    expect(core.REQUIRES_ON_FAIL).toBeDefined();
    expect(core.MCP_TRANSPORTS).toBeDefined();
    expect(core.SKILL_CATEGORIES).toBeDefined();
    expect(core.SKILL_HARNESSES).toBeDefined();
    expect(core.SKILL_ID_PATTERN).toBeInstanceOf(RegExp);
    expect(typeof core.SKILL_ID_MAX_LENGTH).toBe("number");
    expect(typeof core.isValidSkillId).toBe("function");
    expect(core.skillJsonSchema).toBeDefined();
  });

  it("isValidSkillId behaves like the source helper", () => {
    expect(core.isValidSkillId("github")).toBe(true);
    expect(core.isValidSkillId("Bad Id")).toBe(false);
  });

  it("loadAndValidateWorkflow returns ok:true on a known-good fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "sweny-public-api-"));
    const path = join(dir, "wf.yml");
    writeFileSync(
      path,
      `id: demo
name: Demo
entry: a
nodes:
  a: { name: A, instruction: do a, skills: [] }
edges: []
`,
      "utf-8",
    );
    try {
      const result = core.loadAndValidateWorkflow(path);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.workflow.id).toBe("demo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadAndValidateWorkflow returns ok:false with errors on a malformed fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "sweny-public-api-"));
    const path = join(dir, "bad.yml");
    // Missing required `entry`.
    writeFileSync(
      path,
      `id: x
name: X
nodes:
  a: { name: A, instruction: x, skills: [] }
edges: []
`,
      "utf-8",
    );
    try {
      const result = core.loadAndValidateWorkflow(path);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validateParsed validates an already-parsed object", () => {
    const ok = core.validateParsed({
      id: "p",
      name: "P",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: [] } },
      edges: [],
    });
    expect(ok.ok).toBe(true);

    const bad = core.validateParsed({ id: "p", name: "P" });
    expect(bad.ok).toBe(false);
  });

  it("still exports SkillCategory's underlying constant exactly once (no duplicate)", () => {
    // SkillCategory (type) was already exported; SKILL_CATEGORIES (value) is
    // new. Both must resolve without a duplicate-export build error (which
    // would have failed the build before this test ever ran).
    expect(core.SKILL_CATEGORIES).toContain("general");
  });
});

describe("browser surface mirrors the safe constants (issue #213)", () => {
  // The browser entry must mirror the pure-data constants + skill-id helper
  // (no node:fs), so Studio and other browser consumers reach them without
  // hardcoding members. The loader (node:fs) is intentionally NOT here.

  it("mirrors the runtime enum constants + skill-id helpers", () => {
    expect(browser.EVALUATOR_KINDS).toEqual(core.EVALUATOR_KINDS);
    expect(browser.EVAL_POLICIES).toEqual(core.EVAL_POLICIES);
    expect(browser.REQUIRES_ON_FAIL).toEqual(core.REQUIRES_ON_FAIL);
    expect(browser.MCP_TRANSPORTS).toEqual(core.MCP_TRANSPORTS);
    expect(browser.SKILL_CATEGORIES).toEqual(core.SKILL_CATEGORIES);
    expect(browser.SKILL_HARNESSES).toEqual(core.SKILL_HARNESSES);
    expect(browser.SKILL_ID_PATTERN).toEqual(core.SKILL_ID_PATTERN);
    expect(browser.SKILL_ID_MAX_LENGTH).toBe(core.SKILL_ID_MAX_LENGTH);
    expect(typeof browser.isValidSkillId).toBe("function");
    expect(browser.skillJsonSchema).toBeDefined();
  });

  it("does NOT leak the node-only loader into the browser surface", () => {
    // loader.ts imports node:fs; it must stay out of the browser entry.
    expect((browser as Record<string, unknown>).loadAndValidateWorkflow).toBeUndefined();
    expect((browser as Record<string, unknown>).validateParsed).toBeUndefined();
  });
});
