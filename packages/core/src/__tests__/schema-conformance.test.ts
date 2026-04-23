import { describe, it, expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { workflowZ, workflowJsonSchema } from "../schema.js";

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
    name: "node with valid verify (any_tool_called)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: { ...baseNode(), verify: { any_tool_called: ["github_create_issue"] } },
      },
      edges: [],
    },
    expected: true,
  },
  {
    name: "node with valid output_matches (single operator)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: { ...baseNode(), verify: { output_matches: [{ path: "severity", equals: "high" }] } },
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
        a: { ...baseNode(), verify: { output_matches: [{ path: "p", equals: "a", in: ["b"] }] } },
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
      nodes: { a: { ...baseNode(), verify: { output_matches: [{ path: "p" }] } } },
      edges: [],
    },
    expected: false,
  },
  {
    name: "empty verify block (no checks declared)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: { a: { ...baseNode(), verify: {} } },
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
  // agree, so nodeVerifyZ / nodeRequiresZ are now .strict().
  {
    name: "verify with unknown key (strict: both must reject)",
    input: {
      id: "d",
      name: "D",
      entry: "a",
      nodes: {
        a: { ...baseNode(), verify: { any_tool_called: ["x"], unknown_key: true } },
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
          verify: { any_tool_called: ["x"] },
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
          verify: { output_matches: [{ path: "p", equals: 1, rogue: true }] },
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
