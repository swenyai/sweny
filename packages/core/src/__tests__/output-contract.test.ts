/**
 * #573: node outputs are validated against their declared JSON Schema at
 * every depth, with a path-precise error, through the existing repair and
 * retry path. Harness parity lives in output-contract-harnesses.test.ts.
 */
import * as fs from "node:fs";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { execute, outputContractProblems } from "../executor.js";
import { parseWorkflow, validateWorkflow } from "../schema.js";
import {
  COUNT_OF_KEYWORD,
  ROOT_PATH,
  contractFailureMessage,
  listContractProblems,
  outputContractProblems as contractProblems,
  outputSchemaError,
  type ContractProblem,
} from "../output-contract.js";
import { createSkillMap } from "../skills/index.js";
import { WORKFLOW_TEMPLATES } from "../cli/templates.js";
import { PACK_TEMPLATES } from "../cli/packs.js";
import { implementWorkflow, seedContentWorkflow, triageWorkflow } from "../workflows/index.js";
import type { Claude, ExecutionEvent, JSONSchema, Logger, Node, NodeResult, Workflow } from "../types.js";

const silent: Logger = { info() {}, warn() {}, error() {}, debug() {} };

/** Findings-shaped schema: arrays of objects, enums, required at depth, additionalProperties false. */
const FINDINGS: JSONSchema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          location: {
            type: "object",
            properties: { file: { type: "string" }, line: { type: "integer", minimum: 1 } },
            required: ["file"],
          },
        },
        required: ["title", "severity"],
      },
    },
    verdict: { type: "string", enum: ["pass", "fail"] },
  },
  required: ["findings", "verdict"],
};

const GOOD = {
  findings: [{ title: "t", severity: "high", location: { file: "a.ts", line: 3 } }],
  verdict: "fail",
};

const check = (data: unknown, schema: JSONSchema = FINDINGS) =>
  outputContractProblems(data, schema).map(({ field, path, kind, problem }) => ({ field, path, kind, problem }));

// ─── The check itself ────────────────────────────────────────────

describe("outputContractProblems: every depth (#573)", () => {
  it("conforming data has no problems", () => {
    expect(check(GOOD)).toEqual([]);
  });

  it("an enum broken inside an array of objects is named by its exact path", () => {
    const data = { ...GOOD, findings: [GOOD.findings[0], { title: "u", severity: "urgent" }] };
    expect(check(data)).toEqual([
      {
        field: "findings",
        path: "findings[1].severity",
        kind: "invalid",
        problem: 'expected one of ["low","medium","high"], got "urgent"',
      },
    ]);
  });

  it("a required field missing at depth is invalid (the top-level field exists), not missing", () => {
    const data = { ...GOOD, findings: [{ severity: "low", location: {} }] };
    expect(check(data)).toEqual([
      { field: "findings", path: "findings[0].title", kind: "invalid", problem: "required but missing" },
      { field: "findings", path: "findings[0].location.file", kind: "invalid", problem: "required but missing" },
    ]);
  });

  it("a top-level required field that is absent is missing", () => {
    expect(check({ findings: [] })).toEqual([
      { field: "verdict", path: "verdict", kind: "missing", problem: "required but missing" },
    ]);
  });

  it("additionalProperties: false rejects an undeclared key at depth", () => {
    const data = { ...GOOD, findings: [{ ...GOOD.findings[0], owner: "me" }] };
    expect(check(data)).toEqual([
      {
        field: "findings",
        path: "findings[0].owner",
        kind: "invalid",
        problem: "not allowed (additionalProperties: false)",
      },
    ]);
  });

  it("additionalProperties: false at the root rejects an undeclared top-level key", () => {
    const strict = { ...FINDINGS, additionalProperties: false };
    expect(check({ ...GOOD, extra: 1 }, strict)).toEqual([
      { field: "extra", path: "extra", kind: "invalid", problem: "not allowed (additionalProperties: false)" },
    ]);
  });

  it("type mismatches at every depth, with the value that broke it", () => {
    const data = {
      findings: [{ title: 7, severity: "low", location: { file: "a", line: "3" } }, "not an object"],
      verdict: ["pass"],
    };
    expect(check(data)).toEqual([
      { field: "findings", path: "findings[0].title", kind: "invalid", problem: "expected string, got 7" },
      { field: "findings", path: "findings[0].location.line", kind: "invalid", problem: 'expected integer, got "3"' },
      { field: "findings", path: "findings[1]", kind: "invalid", problem: 'expected object, got "not an object"' },
      { field: "verdict", path: "verdict", kind: "invalid", problem: 'expected string, got ["pass"]' },
    ]);
  });

  it("other keywords keep the validator's wording plus the scalar that broke them", () => {
    const data = { ...GOOD, findings: [{ ...GOOD.findings[0], location: { file: "a", line: 0 } }] };
    expect(check(data)).toEqual([
      { field: "findings", path: "findings[0].location.line", kind: "invalid", problem: "must be >= 1, got 0" },
    ]);
  });

  it("reports one problem per path (a type miss is not also an enum miss)", () => {
    expect(check({ findings: [], verdict: 3 })).toEqual([
      { field: "verdict", path: "verdict", kind: "invalid", problem: "expected string, got 3" },
    ]);
  });

  it("a key that is not an identifier, or a digit key on an object, is quoted; only arrays get [n]", () => {
    const schema: JSONSchema = {
      type: "object",
      properties: {
        "odd key": { type: "number" },
        byIndex: { type: "object", properties: { "0": { type: "string" } } },
      },
    };
    expect(check({ "odd key": "x", byIndex: { "0": 1 } }, schema)).toEqual([
      { field: "odd key", path: '["odd key"]', kind: "invalid", problem: 'expected number, got "x"' },
      { field: "byIndex", path: 'byIndex["0"]', kind: "invalid", problem: "expected string, got 1" },
    ]);
  });

  it("const, oneOf and dependentRequired are checked too", () => {
    const schema: JSONSchema = {
      type: "object",
      properties: {
        version: { const: 2 },
        target: { oneOf: [{ type: "string" }, { type: "integer" }] },
        pr: { type: "object", properties: { url: { type: "string" }, number: { type: "integer" } } },
      },
      dependentRequired: { pr: ["branch"] },
    };
    const problems = check({ version: 1, target: true, pr: {} }, schema);
    expect(problems.map((p) => p.path)).toEqual(["version", "target", "branch"]);
    expect(problems[0].problem).toBe("expected 2, got 1");
    expect(problems[2].problem).toBe("required when 'pr' is present, but missing");
  });

  it("the harness summary prose is not output: an undeclared summary passes additionalProperties: false", () => {
    const strict = { ...FINDINGS, additionalProperties: false };
    expect(check({ summary: "the agent's final message", ...GOOD }, strict)).toEqual([]);
  });

  it("a declared summary is checked like any other field", () => {
    const schema: JSONSchema = { type: "object", properties: { summary: { type: "string", maxLength: 3 } } };
    expect(check({ summary: "too long" }, schema)).toEqual([
      expect.objectContaining({ path: "summary", kind: "invalid" }),
    ]);
  });

  it("format is an annotation, not asserted (JSON Schema 2020-12 default)", () => {
    const schema: JSONSchema = { type: "object", properties: { at: { type: "string", format: "date-time" } } };
    expect(check({ at: "yesterday" }, schema)).toEqual([]);
  });

  it("a draft-07 schema with definitions and $ref is honored", () => {
    const schema: JSONSchema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      definitions: { sev: { type: "string", enum: ["low", "high"] } },
      properties: { items: { type: "array", items: { $ref: "#/definitions/sev" } } },
    };
    expect(check({ items: ["low", "mid"] }, schema)).toEqual([
      { field: "items", path: "items[1]", kind: "invalid", problem: 'expected one of ["low","high"], got "mid"' },
    ]);
  });

  it("two schemas with the same $id do not collide", () => {
    const a: JSONSchema = { $id: "https://example.com/out", type: "object", properties: { n: { type: "number" } } };
    const b: JSONSchema = { $id: "https://example.com/out", type: "object", properties: { n: { type: "string" } } };
    expect(check({ n: 1 }, a)).toEqual([]);
    expect(check({ n: 1 }, b)).toEqual([expect.objectContaining({ path: "n" })]);
    expect(check({ n: 1 }, a)).toEqual([]);
  });

  it("a schema that cannot be compiled is a schema problem, not an agent one", () => {
    const problems = check({}, { type: "object", properties: { n: { type: "str" } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ field: "(output)", path: "(output)", kind: "schema" });
    expect(problems[0].problem).toMatch(/^the declared output schema cannot be used: /);
  });

  it("no schema, no problems", () => {
    expect(outputContractProblems({ anything: 1 }, undefined)).toEqual([]);
  });

  it("x-sweny-count-of still checks its count, and skips a count that is already the wrong type", () => {
    const schema: JSONSchema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object" } },
        open: { type: "integer", "x-sweny-count-of": { array: "items", where: { state: ["open"] } } },
      },
    };
    const items = [{ state: "open" }, { state: "closed" }];
    expect(check({ items, open: 1 }, schema)).toEqual([]);
    expect(check({ items, open: 2 }, schema)).toEqual([
      { field: "open", path: "open", kind: "invalid", problem: "is 2 but 'items' has 1 matching item(s)" },
    ]);
    expect(check({ items, open: "2" }, schema)).toEqual([
      { field: "open", path: "open", kind: "invalid", problem: 'expected integer, got "2"' },
    ]);
  });
});

// ─── In the executor: repair, failure, retry, routing ───────────

function oneNode(output: JSONSchema, extra: Partial<Node> = {}): Workflow {
  return {
    id: "contract",
    name: "Contract",
    description: "",
    entry: "review",
    nodes: { review: { name: "Review", instruction: "NODE_REVIEW", skills: [], output, ...extra } },
    edges: [],
  };
}

/** A harness that answers each run with the next scripted data (the last one repeats). */
function scripted(answers: Array<Record<string, unknown>>) {
  const instructions: string[] = [];
  const claude: Claude = {
    async run(opts): Promise<NodeResult> {
      instructions.push(opts.instruction);
      const data = answers[Math.min(instructions.length - 1, answers.length - 1)];
      return { status: "success", data: { summary: "prose", ...data }, toolCalls: [] };
    },
    async evaluate(opts) {
      return opts.choices[0]?.id ?? null;
    },
    async ask() {
      return "VERDICT: no\nREASONING: none";
    },
  };
  return { claude, instructions };
}

const BAD = {
  findings: [GOOD.findings[0], { title: "u", severity: "urgent", owner: "me" }],
  verdict: "fail",
};

const EXPECTED_ERROR =
  "output schema violation: " +
  "findings[1].owner: not allowed (additionalProperties: false); " +
  'findings[1].severity: expected one of ["low","medium","high"], got "urgent"';

describe("executor: nested violations fail the node, through the repair and retry path (#573)", () => {
  it("one repair request naming each path, then the node fails with a path-precise error", async () => {
    const { claude, instructions } = scripted([BAD]);
    const events: ExecutionEvent[] = [];
    const { results } = await execute(
      oneNode(FINDINGS),
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        logger: silent,
        observer: (e) => events.push(e),
      },
    );
    expect(instructions).toHaveLength(2);
    expect(instructions[1]).toContain(
      "- findings[1].owner: not allowed (additionalProperties: false)\n" +
        '- findings[1].severity: expected one of ["low","medium","high"], got "urgent"',
    );
    const r = results.get("review")!;
    expect(r.status).toBe("failed");
    expect(r.data.error).toBe(EXPECTED_ERROR);
    expect(r.evals).toEqual([{ name: "output_schema", kind: "value", pass: false, reasoning: EXPECTED_ERROR }]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "node:warning",
        node: "review",
        fields: ["findings[1].owner", "findings[1].severity"],
      }),
    );
  });

  it("a repaired answer succeeds", async () => {
    const { claude, instructions } = scripted([BAD, GOOD]);
    const { results } = await execute(
      oneNode(FINDINGS),
      {},
      { skills: createSkillMap([]), claude, config: {}, logger: silent },
    );
    expect(instructions).toHaveLength(2);
    expect(results.get("review")?.status).toBe("success");
  });

  it("missing top-level fields keep the required-field wording, and lead the list", async () => {
    const { claude } = scripted([{ findings: [{ title: 1, severity: "low" }] }]);
    const { results } = await execute(
      oneNode(FINDINGS),
      {},
      { skills: createSkillMap([]), claude, config: {}, logger: silent },
    );
    const r = results.get("review")!;
    expect(r.data.error).toBe(
      "output schema violation: required field(s) missing from emitted data: verdict; " +
        "findings[0].title: expected string, got 1",
    );
    expect(r.evals?.[0]?.name).toBe("output_required");
  });

  it("with retry configured, a nested violation takes the reflection and retry path", async () => {
    const { claude, instructions } = scripted([BAD, BAD, GOOD]);
    const { results } = await execute(
      oneNode(FINDINGS, { retry: { max: 1 } }),
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        logger: silent,
      },
    );
    // initial + the one repair + one retry
    expect(instructions).toHaveLength(3);
    expect(results.get("review")?.status).toBe("success");
  });

  it("fail_soft does not soften a nested contract violation", async () => {
    const { claude } = scripted([BAD]);
    const { results } = await execute(
      oneNode(FINDINGS, { fail_soft: true }),
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        logger: silent,
      },
    );
    expect(results.get("review")?.status).toBe("failed");
    expect(results.get("review")?.data).not.toHaveProperty("fail_soft");
  });

  it("a schema that cannot be compiled stops the run at load, before any agent runs", async () => {
    const { claude, instructions } = scripted([{ n: 1 }]);
    await expect(
      execute(
        oneNode({ type: "object", properties: { n: { type: "str" } } }),
        {},
        {
          skills: createSkillMap([]),
          claude,
          config: {},
          logger: silent,
        },
      ),
    ).rejects.toThrow(/INVALID_OUTPUT_SCHEMA: Node "review" declares an output schema that cannot be used: /);
    expect(instructions).toHaveLength(0);
  });

  it("a nested problem under a field an expression routes on falls through instead of failing the node", async () => {
    const wf: Workflow = {
      id: "routed",
      name: "Routed",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "NODE_A",
          skills: [],
          output: {
            type: "object",
            properties: {
              gate: { type: "object", properties: { open: { type: "boolean" } }, required: ["open"] },
            },
            required: ["gate"],
          },
        },
        b: { name: "B", instruction: "NODE_B", skills: [] },
        c: { name: "C", instruction: "NODE_C", skills: [] },
      },
      edges: [
        { from: "a", to: "b", when: { expr: "a.gate.open == true" }, description: "open" },
        { from: "a", to: "c", when: { expr: "a.gate.open == false" }, description: "closed" },
      ],
    };
    const ran: string[] = [];
    let asked = 0;
    const claude: Claude = {
      async run(opts) {
        ran.push(/NODE_([A-Z])/.exec(opts.instruction)![1]);
        return {
          status: "success",
          data: opts.instruction.includes("NODE_A") ? { gate: { open: "yes" } } : {},
          toolCalls: [],
        };
      },
      async evaluate() {
        asked++;
        return "c";
      },
      async ask() {
        return "";
      },
    };
    const { results } = await execute(wf, {}, { skills: createSkillMap([]), claude, config: {}, logger: silent });
    expect(results.get("a")?.status).toBe("success");
    expect(ran).toEqual(["A", "A", "C"]);
    expect(asked).toBe(1);
  });
});

// ─── Our own packs, templates and fixtures ───────────────────────

describe("bundled workflows still pass their own contract (#573)", () => {
  const templates = [...WORKFLOW_TEMPLATES, ...PACK_TEMPLATES].filter(
    (t, i, all) => all.findIndex((o) => o.id === t.id) === i,
  );
  const bundled: Array<[string, Workflow]> = [
    ["triage", triageWorkflow],
    ["implement", implementWorkflow],
    ["seed-content", seedContentWorkflow],
    ...templates.map((t): [string, Workflow] => [t.id, parseWorkflow(parse(t.yaml))]),
  ];
  const schemas = bundled.flatMap(([wid, wf]) =>
    Object.entries(wf.nodes)
      .filter(([, n]) => n.output)
      .map(([nid, n]): [string, JSONSchema] => [`${wid}.${nid}`, n.output!]),
  );

  it("covers every bundled workflow and template", () => {
    expect(bundled.length).toBeGreaterThanOrEqual(15);
    expect(schemas.length).toBeGreaterThanOrEqual(30);
  });

  it.each(schemas)("%s: the declared output schema compiles", (_id, schema) => {
    expect(outputContractProblems({}, schema).filter((p) => p.kind === "schema")).toEqual([]);
  });

  it("the try fixture's sample answer conforms to explain-repo's schema", () => {
    const fixture = JSON.parse(fs.readFileSync(new URL("../cli/try-fixture.json", import.meta.url), "utf8"));
    const explain = bundled.find(([id]) => id === "explain-repo")![1].nodes.explain.output;
    expect(fixture.nodes.explain.output).toBeTypeOf("object");
    expect(outputContractProblems(fixture.nodes.explain.output, explain)).toEqual([]);
  });

  it("the triage routing fixtures conform at every depth", () => {
    // The data when-routing.test.ts feeds the built-in triage graph.
    const fixable = {
      title: "t",
      root_cause: "r",
      severity: "high",
      is_duplicate: false,
      fix_complexity: "simple",
      fix_approach: "patch it",
    };
    const investigate = {
      findings: [fixable],
      novel_count: 1,
      fixable_count: 1,
      highest_severity: "high",
      recommendation: "r",
    };
    const createIssue = { issueTitle: "t", issues: [{ action: "requested" }] };
    const implement = { branch: "b", commit_sha: "c", files_changed: [], test_files_changed: [], test_status: "pass" };
    expect(outputContractProblems(investigate, triageWorkflow.nodes.investigate.output)).toEqual([]);
    expect(outputContractProblems(createIssue, triageWorkflow.nodes.create_issue.output)).toEqual([]);
    expect(outputContractProblems(implement, triageWorkflow.nodes.implement.output)).toEqual([]);
    // A nested enum break in a finding is now caught, with its path.
    expect(
      outputContractProblems(
        { ...investigate, findings: [{ ...fixable, severity: "urgent" }] },
        triageWorkflow.nodes.investigate.output,
      ),
    ).toEqual([expect.objectContaining({ path: "findings[0].severity", kind: "invalid" })]);
  });
});

// ─── Load time: validateWorkflow ─────────────────────────────────

describe("validateWorkflow compiles every output schema with the same validator (#573)", () => {
  it("reports a schema that cannot be compiled with the node id and the validator's message", () => {
    const errors = validateWorkflow(oneNode({ type: "object", properties: { n: { type: "str" } } }));
    expect(errors).toEqual([
      {
        code: "INVALID_OUTPUT_SCHEMA",
        nodeId: "review",
        message:
          'Node "review" declares an output schema that cannot be used: schema is invalid: ' +
          "data/properties/n/type must be equal to one of the allowed values, " +
          "data/properties/n/type must be array, data/properties/n/type must match a schema in anyOf",
      },
    ]);
  });

  it("an unresolvable $ref is reported too", () => {
    const errors = validateWorkflow(oneNode({ type: "object", properties: { n: { $ref: "#/$defs/missing" } } }));
    expect(errors.map((e) => [e.code, e.nodeId])).toEqual([["INVALID_OUTPUT_SCHEMA", "review"]]);
    expect(errors[0].message).toMatch(/can't resolve reference #\/\$defs\/missing/);
  });

  it("a valid schema, or none, is not an error", () => {
    expect(validateWorkflow(oneNode(FINDINGS))).toEqual([]);
    const none = oneNode(FINDINGS);
    delete none.nodes.review.output;
    expect(validateWorkflow(none)).toEqual([]);
  });
});

// ─── The module itself: exact paths and messages ─────────────────

const rows = (data: unknown, schema: unknown) =>
  contractProblems(data, schema as JSONSchema).map((p) => [p.field, p.path, p.kind, p.problem]);
const DRAFT_07 = "http://json-schema.org/draft-07/schema#";
const DRAFT_2019 = "https://json-schema.org/draft/2019-09/schema";
const TUPLE = {
  type: "object",
  properties: { pair: { type: "array", items: [{ type: "string" }, { type: "number" }] } },
};

describe("output-contract: dialects", () => {
  it("draft-07 reads array-form items as a tuple", () => {
    expect(rows({ pair: ["a", "b"] }, { $schema: DRAFT_07, ...TUPLE })).toEqual([
      ["pair", "pair[1]", "invalid", 'expected number, got "b"'],
    ]);
  });

  it("2020-12, the default, rejects array-form items as a schema problem, each complaint once", () => {
    expect(rows({ pair: ["a", "b"] }, TUPLE)).toEqual([
      [
        ROOT_PATH,
        ROOT_PATH,
        "schema",
        "the declared output schema cannot be used: schema is invalid: data/properties/pair/items must be object,boolean",
      ],
    ]);
  });

  it("2019-09 reads tuples and dependentRequired; draft-07 does not know dependentRequired", () => {
    const schema = { ...TUPLE, $schema: DRAFT_2019, dependentRequired: { pair: ["why"] } };
    expect(rows({ pair: ["a", "b"] }, schema)).toEqual([
      ["pair", "pair[1]", "invalid", 'expected number, got "b"'],
      ["why", "why", "invalid", "required when 'pair' is present, but missing"],
    ]);
    expect(rows({ pair: ["a", "b"] }, { ...schema, $schema: DRAFT_07 })).toEqual([
      ["pair", "pair[1]", "invalid", 'expected number, got "b"'],
    ]);
  });

  it("draft-07 dependencies read like dependentRequired", () => {
    expect(rows({ pr: 1 }, { $schema: DRAFT_07, type: "object", dependencies: { pr: ["branch"] } })).toEqual([
      ["branch", "branch", "invalid", "required when 'pr' is present, but missing"],
    ]);
  });
});

describe("output-contract: messages per keyword", () => {
  it.each<[string, unknown, unknown, unknown[]]>([
    [
      "unevaluatedProperties",
      { a: 1, b: 2 },
      { type: "object", properties: { a: { type: "number" } }, unevaluatedProperties: false },
      ["b", "b", "invalid", "not allowed (unevaluatedProperties: false)"],
    ],
    [
      "a union type",
      { n: true },
      { type: "object", properties: { n: { type: ["string", "number"] } } },
      ["n", "n", "invalid", "expected string or number, got true"],
    ],
    [
      "a null scalar keeps its value",
      { n: null },
      { type: "object", properties: { n: { not: { type: "null" } } } },
      ["n", "n", "invalid", "must NOT be valid, got null"],
    ],
    [
      "an array keeps only the wording",
      { l: [] },
      { type: "object", properties: { l: { type: "array", minItems: 1 } } },
      ["l", "l", "invalid", "must NOT have fewer than 1 items"],
    ],
    [
      "an object keeps only the wording",
      { m: {} },
      { type: "object", properties: { m: { type: "object", minProperties: 1 } } },
      ["m", "m", "invalid", "must NOT have fewer than 1 properties"],
    ],
    [
      "the output object itself",
      {},
      { type: "object", minProperties: 1 },
      [ROOT_PATH, ROOT_PATH, "invalid", "must NOT have fewer than 1 properties"],
    ],
    [
      "a value of exactly 80 characters is shown whole",
      { s: 1 },
      { type: "object", properties: { s: { const: "x".repeat(78) } } },
      ["s", "s", "invalid", `expected "${"x".repeat(78)}", got 1`],
    ],
    [
      "a longer value is cut to 77 characters and an ellipsis",
      { s: 1 },
      { type: "object", properties: { s: { const: "x".repeat(79) } } },
      ["s", "s", "invalid", `expected "${"x".repeat(76)}..., got 1`],
    ],
  ])("%s", (_label, data, schema, row) => {
    expect(rows(data, schema)).toEqual([row]);
  });

  it("the root path reads (output)", () => {
    expect(ROOT_PATH).toBe("(output)");
  });
});

describe("output-contract: paths", () => {
  it("quotes keys that are not identifiers, and unescapes / and ~ from the pointer", () => {
    const data = { "a/b": 1, "t~x": 1, "fix-plan": 1, "2fa": 1, _a1: 1, $v: 1 };
    expect(rows(data, { type: "object", additionalProperties: { type: "string" } }).map((r) => r[1])).toEqual([
      '["a/b"]',
      '["t~x"]',
      "fix-plan",
      '["2fa"]',
      "_a1",
      "$v",
    ]);
  });

  it("indexes nested arrays and multi-digit positions", () => {
    const schema = {
      type: "object",
      properties: {
        m: { type: "array", items: { type: "array", items: { type: "number" } } },
        l: { type: "array", items: { type: "number" } },
        o: { type: "object", properties: { deep: { type: "object", properties: { v: { type: "string" } } } } },
      },
    };
    const data = {
      m: [
        [1, 2],
        [3, "x"],
      ],
      l: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "x"],
      o: { deep: { v: 1 } },
    };
    expect(rows(data, schema)).toEqual([
      ["m", "m[1][1]", "invalid", 'expected number, got "x"'],
      ["l", "l[10]", "invalid", 'expected number, got "x"'],
      ["o", "o.deep.v", "invalid", "expected string, got 1"],
    ]);
  });
});

describe("output-contract: inputs", () => {
  const required = { type: "object", required: ["a"] };

  it("data that is not an object is checked as an empty object", () => {
    for (const data of [null, undefined, "str", 3]) {
      expect(rows(data, required)).toEqual([["a", "a", "missing", "required but missing"]]);
    }
  });

  it("no schema (or one that is not an object) checks nothing; an array schema is a schema problem", () => {
    expect(contractProblems({ a: 1 }, undefined)).toEqual([]);
    expect(rows({ a: 1 }, "x")).toEqual([]);
    expect(rows({}, [])).toEqual([
      [
        ROOT_PATH,
        ROOT_PATH,
        "schema",
        "the declared output schema cannot be used: schema is invalid: data must be object,boolean",
      ],
    ]);
  });

  it("a summary the schema only requires is kept; one it does not name is dropped", () => {
    expect(rows({ summary: "s" }, { type: "object", required: ["summary"] })).toEqual([]);
    expect(rows({ summary: "s" }, { type: "object", additionalProperties: false })).toEqual([]);
    expect(rows({ summary: 1 }, { type: "object", properties: { summary: { type: "string" } } })).toEqual([
      ["summary", "summary", "invalid", "expected string, got 1"],
    ]);
  });

  it("the same schema object gives the same answer every time", () => {
    const schema = { type: "object", properties: { n: { type: "number" } } };
    expect(rows({ n: "1" }, schema)).toEqual(rows({ n: "1" }, schema));
    expect(rows({ n: 1 }, schema)).toEqual([]);
  });

  it("outputSchemaError: undefined for none or a valid schema, the deduplicated message otherwise", () => {
    expect(outputSchemaError(undefined)).toBeUndefined();
    expect(outputSchemaError({ type: "object" })).toBeUndefined();
    expect(outputSchemaError({ type: "str" })).toBe(
      "schema is invalid: data/type must be equal to one of the allowed values, data/type must be array, " +
        "data/type must match a schema in anyOf",
    );
  });
});

describe("output-contract: x-sweny-count-of", () => {
  const counted = (spec: unknown, extra: Record<string, unknown> = {}) => ({
    type: "object",
    properties: { items: { type: "array" }, n: { type: "integer", [COUNT_OF_KEYWORD]: spec }, ...extra },
  });

  it("is the keyword sweny documents", () => {
    expect(COUNT_OF_KEYWORD).toBe("x-sweny-count-of");
  });

  it("counts every object item when nothing narrows it (arrays are objects; null and scalars are not)", () => {
    const items = [{}, "x", null, 3, []];
    expect(rows({ items, n: 2 }, counted({ array: "items" }))).toEqual([]);
    expect(rows({ items, n: 3 }, counted({ array: "items" }))).toEqual([
      ["n", "n", "invalid", "is 3 but 'items' has 2 matching item(s)"],
    ]);
  });

  it("where and non_empty both narrow it", () => {
    const spec = { array: "items", where: { s: ["open"] }, non_empty: ["t"] };
    const items = [
      { s: "open", t: "a" },
      { s: "open", t: "  " },
      { s: "open", t: 3 },
      { s: "open" },
      { s: "closed", t: "a" },
    ];
    expect(rows({ items, n: 1 }, counted(spec))).toEqual([]);
    expect(rows({ items, n: 0 }, counted(spec))).toEqual([
      ["n", "n", "invalid", "is 0 but 'items' has 1 matching item(s)"],
    ]);
  });

  it("a where whose allowed values are not a list matches nothing", () => {
    expect(rows({ items: [{ s: "open" }], n: 0 }, counted({ array: "items", where: { s: "open" } }))).toEqual([]);
  });

  it("an array that is absent or not a list cannot be checked", () => {
    const loose = { type: "object", properties: { items: {}, n: { [COUNT_OF_KEYWORD]: { array: "items" } } } };
    expect(rows({ items: 3, n: 0 }, loose)).toEqual([
      ["n", "n", "invalid", "cannot be checked: 'items' is not a list"],
    ]);
    expect(rows({ n: 0 }, loose)).toEqual([["n", "n", "invalid", "cannot be checked: 'items' is not a list"]]);
  });

  it("an absent count, or a spec without a string array, is not checked", () => {
    expect(rows({ items: [{}] }, counted({ array: "items" }))).toEqual([]);
    for (const spec of [{ where: {} }, { array: 3 }, "items", null]) {
      expect(rows({ items: [{}], n: 5 }, counted(spec))).toEqual([]);
    }
  });

  it("boolean property schemas next to it are fine", () => {
    expect(rows({ items: [{}], n: 5, b: 1 }, counted({ array: "items" }, { b: true }))).toEqual([
      ["n", "n", "invalid", "is 5 but 'items' has 1 matching item(s)"],
    ]);
  });
});

describe("output-contract: listing and the node error", () => {
  const p = (path: string, kind: ContractProblem["kind"] = "invalid", problem = "bad"): ContractProblem => ({
    field: path,
    path,
    kind,
    problem,
  });

  it("lists up to 20 problems, then counts the rest", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => p(`k${i}`));
    expect(listContractProblems(twenty)).toEqual(twenty.map((x) => `${x.path}: bad`));
    const many = [...twenty, p("k20"), p("k21")];
    expect(listContractProblems(many)).toEqual([...twenty.map((x) => `${x.path}: bad`), "and 2 more"]);
  });

  it("names missing top-level fields together, first, and the rest as path: problem", () => {
    expect(contractFailureMessage([p("a", "missing"), p("b", "missing")])).toBe(
      "output schema violation: required field(s) missing from emitted data: a, b",
    );
    expect(contractFailureMessage([p("x.y"), p("a", "missing"), p("(output)", "schema", "cannot")])).toBe(
      "output schema violation: required field(s) missing from emitted data: a; x.y: bad; (output): cannot",
    );
    expect(contractFailureMessage([p("x[0]")])).toBe("output schema violation: x[0]: bad");
  });

  it("caps the node error the same way", () => {
    const many = Array.from({ length: 21 }, (_, i) => p(`k${i}`));
    expect(contractFailureMessage(many)).toMatch(/; k19: bad; and 1 more$/);
  });
});
