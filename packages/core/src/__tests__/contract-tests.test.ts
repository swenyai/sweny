/**
 * Contract tests for cross-module / cross-source-of-truth invariants.
 *
 * Each block here guards a fact that lives in two places (runtime + spec,
 * cli + loader, ...) and would silently drift otherwise. The plan
 * driving this file lives at docs/hardening/contract-tests.md.
 *
 * If a test fails: the two sources diverged. Pick one as canonical, fix
 * the other, update or delete the test if the surface no longer applies.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EVALUATOR_KINDS,
  EVAL_POLICIES,
  MCP_TRANSPORTS,
  REQUIRES_ON_FAIL,
  SKILL_CATEGORIES,
  SKILL_HARNESSES,
  SKILL_ID_MAX_LENGTH,
  SKILL_ID_PATTERN,
  isValidSkillId,
} from "../types.js";

const SPEC_DIR = join(__dirname, "../../../../spec/public/schemas");
const skillSchema = JSON.parse(readFileSync(join(SPEC_DIR, "skill.json"), "utf-8"));
const workflowSchema = JSON.parse(readFileSync(join(SPEC_DIR, "workflow.json"), "utf-8"));

describe("S1: skill ID validation contract", () => {
  // The spec pattern, runtime regex, and `isValidSkillId` helper all
  // describe the same rule. They MUST agree on every input.
  const corpus: Array<[string, boolean]> = [
    // Valid
    ["github", true],
    ["my-skill", true],
    ["a", true],
    ["a-b", true],
    ["voyage-embeddings", true],
    ["9foo", true], // digits allowed at start (runtime semantics)
    ["a1", true],
    ["x".repeat(64), true], // exactly at the cap

    // Invalid: structural
    ["", false],
    ["A", false], // uppercase rejected
    ["foo_bar", false], // underscores rejected
    ["foo bar", false], // spaces rejected
    ["foo!", false], // punctuation rejected

    // Invalid: hyphen rules
    ["-foo", false], // leading hyphen
    ["foo-", false], // trailing hyphen
    ["foo--bar", false], // consecutive hyphens

    // Invalid: length
    ["x".repeat(65), false], // one over the cap
  ];

  it.each(corpus)("isValidSkillId(%j) === %s", (id, expected) => {
    expect(isValidSkillId(id)).toBe(expected);
  });

  it("the published JSON Schema's id pattern matches the runtime regex source", () => {
    expect(skillSchema.properties.id.pattern).toBe(SKILL_ID_PATTERN.source);
  });

  it("the published JSON Schema's maxLength matches the runtime cap", () => {
    expect(skillSchema.properties.id.maxLength).toBe(SKILL_ID_MAX_LENGTH);
  });
});

describe("S2: skill JSON Schema is generated from runtime", () => {
  it("category enum matches SKILL_CATEGORIES", () => {
    expect([...skillSchema.properties.category.enum].sort()).toEqual([...SKILL_CATEGORIES].sort());
  });

  it("McpServerConfig.type enum matches MCP_TRANSPORTS", () => {
    expect([...skillSchema.$defs.McpServerConfig.properties.type.enum].sort()).toEqual([...MCP_TRANSPORTS].sort());
  });
});

describe("S3: harness directories are a single source", () => {
  // The CLI writes scaffolds; the loader scans for them. They must agree
  // on which paths count as a skill harness.
  it("SKILL_HARNESSES has one entry per harness key with no duplicates", () => {
    const keys = SKILL_HARNESSES.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every harness path starts with a leading dot", () => {
    for (const h of SKILL_HARNESSES) {
      expect(h.path.startsWith(".")).toBe(true);
    }
  });
});

describe("S4: workflow JSON Schema enums match runtime tuples", () => {
  // Each path here was located against the actual generated schema; if a
  // generator refactor moves them, fix the path here. The point is that
  // the enum *values* match runtime, regardless of nesting.
  it("Evaluator.kind enum matches EVALUATOR_KINDS", () => {
    const evalKindEnum = workflowSchema.$defs.Evaluator.properties.kind.enum;
    expect([...evalKindEnum].sort()).toEqual([...EVALUATOR_KINDS].sort());
  });

  it("Node.eval_policy enum matches EVAL_POLICIES", () => {
    const policyEnum = workflowSchema.properties.nodes.additionalProperties.properties.eval_policy.enum;
    expect([...policyEnum].sort()).toEqual([...EVAL_POLICIES].sort());
  });

  it("NodeRequires.on_fail enum matches REQUIRES_ON_FAIL", () => {
    const onFailEnum = workflowSchema.properties.nodes.additionalProperties.properties.requires.properties.on_fail.enum;
    expect([...onFailEnum].sort()).toEqual([...REQUIRES_ON_FAIL].sort());
  });

  it("Inline skill McpServerConfig.type enum matches MCP_TRANSPORTS", () => {
    const transportEnum = workflowSchema.properties.skills.additionalProperties.properties.mcp.properties.type.enum;
    expect([...transportEnum].sort()).toEqual([...MCP_TRANSPORTS].sort());
  });
});
