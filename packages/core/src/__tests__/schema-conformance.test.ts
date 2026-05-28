import { describe, it, expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { workflowZ, workflowJsonSchema, skillZ, skillJsonSchema } from "../schema.js";

// Fix #4: the Zod parser and the exported JSON Schema must agree.
// IDE / CI tools fetch `workflowJsonSchema` (and the published
// `spec/public/schemas/workflow.json` built from it) to validate
// user-authored workflows. If Zod rejects what ajv accepts, users get
// passing editor validation and failing runtime — and vice versa.
//
// This suite runs the same positive + negative fixtures through both
// validators and fails CI on any disagreement.

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(workflowJsonSchema);

interface Fixture {
  name: string;
  input: unknown;
  /** Whether BOTH validators should accept this. */
  expected: boolean;
}

function baseNode() {
  return { name: "A", instruction: "do a", skills: [] };
}

const fixtures: Fixture[] = [
  // ── Positive ──────────────────────────────────────────────────────
  {
    name: "minimal valid workflow",
    input: {
      id: "demo",
      name: "Demo",
      description: "d",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
    },
    expected: true,
  },
  {
    name: "node and workflow with execution model",
    input: {
      id: "demo",
      name: "Demo",
      description: "d",
      entry: "a",
      model: "claude-opus-4-6",
      nodes: { a: { ...baseNode(), model: "claude-haiku-4-5" } },
      edges: [],
    },
    expected: true,
  },
  {
    name: "node model empty string (rejected by minLength)",
    input: {
      id: "demo",
      name: "Demo",
      description: "d",
      entry: "a",
      nodes: { a: { ...baseNode(), model: "" } },
      edges: [],
    },
    expected: false,
  },
  {
    name: "workflow with bounded self-loop",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [{ from: "a", to: "a", max_iterations: 3 }],
    },
    expected: true,
  },
  {
    name: "node with valid eval (function any_tool_called)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [{ name: "called", kind: "function", rule: { any_tool_called: ["github_create_issue"] } }],
        },
      },
      edges: [],
    },
    expected: true,
  },
  {
    name: "node with valid eval (value output_matches single operator)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [{ name: "shape", kind: "value", rule: { output_matches: [{ path: "severity", equals: "high" }] } }],
        },
      },
      edges: [],
    },
    expected: true,
  },
  {
    name: "node with valid judge evaluator",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: { ...baseNode(), eval: [{ name: "judged", kind: "judge", rubric: "is it good?", pass_when: "yes" }] },
      },
      edges: [],
    },
    expected: true,
  },
  {
    name: "inline skill with instruction",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), skills: ["custom"] } },
      edges: [],
      skills: { custom: { instruction: "do it" } },
    },
    expected: true,
  },
  {
    name: "inline skill with mcp.url (http)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), skills: ["c"] } },
      edges: [],
      skills: { c: { mcp: { url: "https://example.com/mcp" } } },
    },
    expected: true,
  },

  // ── Negative — Zod refine invariants ──────────────────────────────
  {
    name: "output_matches entry with two operators (violates exactly-one)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [
            {
              name: "shape",
              kind: "value",
              rule: { output_matches: [{ path: "p", equals: "a", in: ["b"] }] },
            },
          ],
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "output_matches entry with zero operators",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [{ name: "shape", kind: "value", rule: { output_matches: [{ path: "p" }] } }],
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "empty eval array (rejected at the field level)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), eval: [] } },
      edges: [],
    },
    expected: false,
  },
  {
    name: "value evaluator missing rule",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), eval: [{ name: "x", kind: "value" }] } },
      edges: [],
    },
    expected: false,
  },
  {
    name: "judge evaluator missing rubric",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), eval: [{ name: "x", kind: "judge" }] } },
      edges: [],
    },
    expected: false,
  },
  {
    name: "verify-shaped workflow is rejected (hard cut)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: { ...baseNode(), verify: { any_tool_called: ["x"] } },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "empty requires block (no checks declared)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), requires: { on_fail: "skip" } } },
      edges: [],
    },
    expected: false,
  },
  {
    name: "inline skill with neither instruction nor mcp",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), skills: ["c"] } },
      edges: [],
      skills: { c: { name: "Custom", description: "nothing actionable" } },
    },
    expected: false,
  },
  {
    name: "inline skill with mcp but no command or url",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), skills: ["c"] } },
      edges: [],
      skills: { c: { mcp: { type: "stdio" } } },
    },
    expected: false,
  },

  // Self-review gap: Zod strips unknown keys by default, JSON Schema
  // rejects them via additionalProperties: false. Both validators must
  // agree, so evaluatorZ / nodeRequiresZ are now .strict().
  {
    name: "evaluator rule with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [
            {
              name: "x",
              kind: "function",
              rule: { any_tool_called: ["x"], unknown_key: true },
            },
          ],
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "evaluator object with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [
            {
              name: "x",
              kind: "function",
              rule: { any_tool_called: ["x"] },
              extra: "stray",
            },
          ],
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "requires with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: { ...baseNode(), requires: { output_required: ["x"], mystery: 1 } },
      },
      edges: [],
    },
    expected: false,
  },

  // Round 2 self-review: .strict() was only applied to verify/requires.
  // All other objects with additionalProperties: false must also reject
  // unknown keys. Fixtures for each.
  {
    name: "node with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), bogus_field: 1 } },
      edges: [],
    },
    expected: false,
  },
  {
    name: "edge with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode(), b: baseNode() },
      edges: [{ from: "a", to: "b", weight: 5 }],
    },
    expected: false,
  },
  {
    name: "retry with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [{ name: "x", kind: "function", rule: { any_tool_called: ["x"] } }],
          retry: { max: 3, extra: true },
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "output_matches entry with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [
            {
              name: "shape",
              kind: "value",
              rule: { output_matches: [{ path: "p", equals: 1, rogue: true }] },
            },
          ],
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "inline skill with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), skills: ["c"] } },
      edges: [],
      skills: { c: { instruction: "do it", extra: "nope" } },
    },
    expected: false,
  },
  {
    name: "inline skill mcp with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), skills: ["c"] } },
      edges: [],
      skills: { c: { mcp: { url: "https://x.example", custom_field: 1 } } },
    },
    expected: false,
  },
  {
    name: "top-level unknown key is tolerated (marketplace metadata)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      author: "alice",
      category: "triage",
      tags: ["x", "y"],
    },
    expected: true,
  },

  // ── Positive — new fields: inputs + disallowed_tools ─────────────
  {
    name: "workflow with a declared inputs block (string + boolean + default)",
    input: {
      id: "release-notes",
      name: "Release Notes",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: {
        since_tag: { type: "string", required: true },
        draft: { type: "boolean", default: false },
        labels: { type: "string[]", default: [] },
      },
    },
    expected: true,
  },
  {
    name: "node with disallowed_tools",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: { ...baseNode(), disallowed_tools: ["WebFetch", "WebSearch"] },
      },
      edges: [],
    },
    expected: true,
  },

  // ── Negative — structural (shared by Zod schema parse + structural check) ──
  // These are rejected by Zod parse, so they should also be rejected by the
  // exported JSON Schema. (Structural checks like SELF_LOOP and UNREACHABLE
  // are NOT in the JSON Schema by design — they're post-parse validation.)
  {
    name: "missing required field (entry)",
    input: {
      id: "d",
      name: "D",
      nodes: { a: baseNode() },
      edges: [],
    },
    expected: false,
  },
  {
    name: "wrong type (nodes as string)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: "not an object",
      edges: [],
    },
    expected: false,
  },
  // ── Negative — new fields ────────────────────────────────────────
  {
    // Spec contract (workflow.mdx Inputs: "An InputField MUST NOT declare
    // both `required: true` and a `default`"). The Zod parser rejected this
    // from day one; the JSON Schema needs the matching `not` constraint or
    // editor/CI validators silently pass workflows the runtime will reject.
    name: "inputs field declaring both required: true and a default",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: {
        bad: { type: "string", required: true, default: "fallback" },
      },
    },
    expected: false,
  },
  {
    name: "inputs field with required: false plus default (legal: false is the default)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: {
        ok: { type: "string", required: false, default: "fallback" },
      },
    },
    expected: true,
  },
  {
    name: "inputs field with unknown type",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: {
        when: { type: "date" },
      },
    },
    expected: false,
  },
  {
    name: "disallowed_tools with an empty-string entry",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), disallowed_tools: [""] } },
      edges: [],
    },
    expected: false,
  },

  // ── Negative — evaluator cross-kind drift (issue #214 fix #1) ──────
  // evaluatorZ.superRefine rejects value/function evaluators that carry
  // judge-only fields (rubric/pass_when/model) and judge evaluators that
  // carry a rule. The JSON Schema must forbid the same wrong-kind fields,
  // not just require the right one.
  {
    name: "value evaluator carrying a rubric (judge-only field)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [{ name: "x", kind: "value", rule: { any_tool_called: ["t"] }, rubric: "is it good?" }],
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "function evaluator carrying pass_when (judge-only field)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [{ name: "x", kind: "function", rule: { any_tool_called: ["t"] }, pass_when: "yes" }],
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "value evaluator carrying model (judge-only field)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [{ name: "x", kind: "value", rule: { any_tool_called: ["t"] }, model: "claude-haiku-4-5" }],
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "judge evaluator carrying a rule (value/function-only field)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [{ name: "x", kind: "judge", rubric: "good?", rule: { any_tool_called: ["t"] } }],
        },
      },
      edges: [],
    },
    expected: false,
  },
  {
    name: "judge evaluator with rubric + model (model is judge-legal)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: {
          ...baseNode(),
          eval: [{ name: "x", kind: "judge", rubric: "good?", model: "claude-haiku-4-5", pass_when: "yes" }],
        },
      },
      edges: [],
    },
    expected: true,
  },

  // ── inputs default / enum type drift (issue #214 fix #2) ──────────
  // workflowInputFieldZ.superRefine type-checks `default` and each `enum`
  // element against the declared `type`. The JSON Schema must encode the
  // same per-type constraint or a type:number field with a string default
  // passes ajv but throws under Zod.
  {
    name: "inputs number field with a string default (type mismatch)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: { count: { type: "number", default: "nope" } },
    },
    expected: false,
  },
  {
    name: "inputs number field with a numeric default (ok)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: { count: { type: "number", default: 3 } },
    },
    expected: true,
  },
  {
    name: "inputs boolean field with a string default (type mismatch)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: { flag: { type: "boolean", default: "true" } },
    },
    expected: false,
  },
  {
    name: "inputs string field with a numeric enum element (type mismatch)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: { level: { type: "string", enum: ["low", 2, "high"] } },
    },
    expected: false,
  },
  {
    name: "inputs string field with a string enum (ok)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: { level: { type: "string", enum: ["low", "high"] } },
    },
    expected: true,
  },
  {
    name: "inputs string[] field with a non-string array element default (type mismatch)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: { labels: { type: "string[]", default: ["a", 2] } },
    },
    expected: false,
  },
  {
    name: "inputs string[] field with a string[] default (ok)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: baseNode() },
      edges: [],
      inputs: { labels: { type: "string[]", default: ["a", "b"] } },
    },
    expected: true,
  },
];

describe("Zod ↔ JSON Schema conformance", () => {
  for (const f of fixtures) {
    it(`${f.expected ? "accepts" : "rejects"}: ${f.name}`, () => {
      const zodOk = workflowZ.safeParse(f.input).success;
      const ajvOk = validate(f.input) as boolean;

      // Both validators must produce the same verdict as the expectation.
      // If they disagree, print both results so the failure message says
      // which validator drifted.
      expect({ zod: zodOk, ajv: ajvOk }).toEqual({ zod: f.expected, ajv: f.expected });
    });
  }
});

// ── Skill schema conformance (issue #214 fix #3) ────────────────────
// The skill JSON Schema (published as spec/public/schemas/skill.json) must
// agree with skillZ. Before #214: `mcpAliases` was missing from the schema
// (additionalProperties: false) so ajv rejected valid skills, and the tools
// branch `required: ["tools"]` was satisfied by `tools: []` so an empty-tools
// skill with no instruction/mcp passed ajv but failed Zod.
const validateSkill = ajv.compile(skillJsonSchema);

function baseSkill() {
  return { id: "my-skill", name: "My Skill", description: "does things", category: "general", config: {} };
}

const skillFixtures: Fixture[] = [
  {
    name: "skill with a single tool",
    input: {
      ...baseSkill(),
      tools: [{ name: "do_it", description: "does it", input_schema: { type: "object" } }],
    },
    expected: true,
  },
  {
    name: "skill with instruction only",
    input: { ...baseSkill(), instruction: "be helpful" },
    expected: true,
  },
  {
    name: "skill with mcp (http url)",
    input: { ...baseSkill(), instruction: "x", mcp: { url: "https://example.com/mcp" } },
    expected: true,
  },
  {
    name: "skill with mcpAliases (accepted by both)",
    input: {
      ...baseSkill(),
      instruction: "x",
      mcpAliases: { github: ["create_issue", "list_issues"] },
    },
    expected: true,
  },
  {
    name: "skill with empty tools and no instruction/mcp (rejected by both)",
    input: { ...baseSkill(), tools: [] },
    expected: false,
  },
  {
    name: "skill with empty tools but with instruction (ok)",
    input: { ...baseSkill(), tools: [], instruction: "be helpful" },
    expected: true,
  },
  {
    name: "skill with mcpAliases mapping to an empty array (rejected by both)",
    input: { ...baseSkill(), instruction: "x", mcpAliases: { github: [] } },
    expected: false,
  },
  {
    name: "skill with mcpAliases containing an empty-string alias (rejected by both)",
    input: { ...baseSkill(), instruction: "x", mcpAliases: { github: [""] } },
    expected: false,
  },
  {
    name: "skill missing required category (rejected by both)",
    input: { id: "x", name: "X", description: "d", config: {}, instruction: "y" },
    expected: false,
  },
];

describe("Skill Zod ↔ JSON Schema conformance", () => {
  for (const f of skillFixtures) {
    it(`${f.expected ? "accepts" : "rejects"}: ${f.name}`, () => {
      const zodOk = skillZ.safeParse(f.input).success;
      const ajvOk = validateSkill(f.input) as boolean;
      expect({ zod: zodOk, ajv: ajvOk }).toEqual({ zod: f.expected, ajv: f.expected });
    });
  }
});
