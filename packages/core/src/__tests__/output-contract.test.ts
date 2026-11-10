/**
 * #573: node outputs are validated against their declared JSON Schema at
 * every depth, with a path-precise error, through the existing repair and
 * retry path. Harness parity lives in output-contract-harnesses.test.ts.
 */
import * as fs from "node:fs";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { execute, outputContractProblems } from "../executor.js";
import { createRequire } from "node:module";
import { parseWorkflow, validateWorkflow, type WorkflowWarning } from "../schema.js";
import { validateParsed } from "../loader.js";
import { DRAFT_06_META_SCHEMA } from "../output-contract-draft06.js";
import {
  COUNT_OF_KEYWORD,
  ROOT_PATH,
  MAX_OUTPUT_DEPTH,
  MAX_OUTPUT_VALUES,
  checkOutputContract,
  contractFailureMessage,
  contractPaths,
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
        problem: 'expected one of ["low","medium","high"]',
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

  it("type mismatches at every depth, named by rule, never by value", () => {
    const data = {
      findings: [{ title: 7, severity: "low", location: { file: "a", line: "3" } }, "not an object"],
      verdict: ["pass"],
    };
    expect(check(data)).toEqual([
      { field: "findings", path: "findings[0].title", kind: "invalid", problem: "expected string" },
      { field: "findings", path: "findings[0].location.line", kind: "invalid", problem: "expected integer" },
      { field: "findings", path: "findings[1]", kind: "invalid", problem: "expected object" },
      { field: "verdict", path: "verdict", kind: "invalid", problem: "expected string" },
    ]);
  });

  it("other keywords keep the validator's wording, without the value", () => {
    const data = { ...GOOD, findings: [{ ...GOOD.findings[0], location: { file: "a", line: 0 } }] };
    expect(check(data)).toEqual([
      { field: "findings", path: "findings[0].location.line", kind: "invalid", problem: "must be >= 1" },
    ]);
  });

  it("reports one problem per path (a type miss is not also an enum miss)", () => {
    expect(check({ findings: [], verdict: 3 })).toEqual([
      { field: "verdict", path: "verdict", kind: "invalid", problem: "expected string" },
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
      { field: "odd key", path: '["odd key"]', kind: "invalid", problem: "expected number" },
      { field: "byIndex", path: 'byIndex["0"]', kind: "invalid", problem: "expected string" },
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
    expect(problems[0].problem).toBe("expected 2");
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
      { field: "items", path: "items[1]", kind: "invalid", problem: 'expected one of ["low","high"]' },
    ]);
  });

  it("two schemas with the same $id do not collide: both compile and check at depth", () => {
    // A nested rule, so the top-level fallback could not produce this problem.
    const nested = (t: string): JSONSchema => ({
      $id: "https://example.com/out",
      type: "object",
      properties: { n: { type: "object", properties: { v: { type: t } } } },
    });
    const a = nested("number");
    const b = nested("string");
    expect(outputContractProblems({ n: { v: 1 } }, a)).toEqual([]);
    expect(outputSchemaError(b)).toBeUndefined();
    expect(outputContractProblems({ n: { v: 1 } }, b)).toEqual([
      { field: "n", path: "n.v", kind: "invalid", problem: "expected string" },
    ]);
    expect(outputContractProblems({ n: { v: "1" } }, a)).toEqual([
      { field: "n", path: "n.v", kind: "invalid", problem: "expected number" },
    ]);
  });

  it("a schema that cannot be compiled keeps the pre-#573 top-level check (an unknown type is not checked)", () => {
    expect(check({ n: 1 }, { type: "object", properties: { n: { type: "str" } } })).toEqual([]);
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
    // On a schema that compiles the count problem is not a fallback one: it fails the node.
    expect(outputContractProblems({ items, open: 2 }, schema)).toEqual([
      {
        field: "open",
        path: "open",
        kind: "invalid",
        problem: "does not match the count: 'items' has 1 matching item(s)",
      },
    ]);
    expect(check({ items, open: "2" }, schema)).toEqual([
      { field: "open", path: "open", kind: "invalid", problem: "expected integer" },
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
  'findings[1].severity: expected one of ["low","medium","high"]';

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
        '- findings[1].severity: expected one of ["low","medium","high"]',
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
        "findings[0].title: expected string",
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

  it("a schema that cannot be compiled still runs, with a warning, on the pre-#573 rules", async () => {
    // Tuple items without $schema do not compile under 2020-12. A wrong
    // top-level type is repaired once and then tolerated, as before #573.
    const schema: JSONSchema = {
      type: "object",
      properties: { pair: { type: "array", items: [{ type: "string" }] }, n: { type: "number" } },
      required: ["n"],
    };
    const warnings: string[] = [];
    const logger: Logger = { ...silent, warn: (m: string) => void warnings.push(m) };
    const { claude, instructions } = scripted([{ n: "x", pair: [1] }]);
    const { results } = await execute(oneNode(schema), {}, { skills: createSkillMap([]), claude, config: {}, logger });
    expect(results.get("review")?.status).toBe("success");
    expect(instructions).toHaveLength(2);
    expect(instructions[1]).toContain("- n: expected number\n");
    expect(warnings[0]).toMatch(
      /^ {2}OUTPUT_SCHEMA_FALLBACK: Node "review" declares an output schema the validator cannot compile/,
    );
  });

  it("on the fallback a missing required field still fails the node", async () => {
    const schema: JSONSchema = {
      type: "object",
      properties: { a: { type: "string", required: true } },
      required: ["n"],
    };
    const { claude } = scripted([{}]);
    const { results } = await execute(
      oneNode(schema),
      {},
      { skills: createSkillMap([]), claude, config: {}, logger: silent },
    );
    expect(results.get("review")?.status).toBe("failed");
    expect(results.get("review")?.data.error).toBe(
      "output schema violation: required field(s) missing from emitted data: n",
    );
  });

  it("tells the harness the executor runs the one repair (no correction turn of its own)", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const claude: Claude = {
      async run(opts): Promise<NodeResult> {
        seen.push(opts as unknown as Record<string, unknown>);
        return { status: "success", data: GOOD, toolCalls: [] };
      },
      async evaluate() {
        return null;
      },
      async ask() {
        return "";
      },
    };
    const wf = oneNode(FINDINGS);
    wf.nodes.plain = { name: "Plain", instruction: "NODE_PLAIN", skills: [] };
    wf.edges = [{ from: "review", to: "plain" }];
    await execute(wf, {}, { skills: createSkillMap([]), claude, config: {}, logger: silent });
    expect(seen[0].callerRepairsOutput).toBe(true);
    expect(seen[1]).not.toHaveProperty("callerRepairsOutput");
  });

  it("never puts an emitted value in the error, the evals, the repair request, the logs or the events", async () => {
    const secret = "ghp_" + "a".repeat(36);
    const schema: JSONSchema = {
      type: "object",
      properties: {
        token: { type: "number" },
        short: { type: "string", maxLength: 3 },
        pick: { enum: ["a"] },
        exact: { const: "b" },
        url: { type: "string", pattern: "^https://" },
        nested: { type: "array", items: { type: "object", properties: { v: { type: "integer" } } } },
      },
    };
    const data = { token: secret, short: secret, pick: secret, exact: secret, url: secret, nested: [{ v: secret }] };
    const lines: string[] = [];
    const logger: Logger = {
      info() {},
      debug() {},
      warn: (m) => void lines.push(String(m)),
      error: (m) => void lines.push(String(m)),
    };
    const events: ExecutionEvent[] = [];
    const { claude, instructions } = scripted([data]);
    const { results } = await execute(
      oneNode(schema),
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        logger,
        observer: (e) => events.push(e),
      },
    );
    const r = results.get("review")!;
    expect(r.status).toBe("failed");
    expect(r.data.error).toBe(
      "output schema violation: token: expected number; short: must NOT have more than 3 characters; " +
        'pick: expected one of ["a"]; exact: expected "b"; url: must match pattern "^https://"; ' +
        "nested[0].v: expected integer",
    );
    const said = [String(r.data.error), JSON.stringify(r.evals), instructions[1].split("---")[0], ...lines];
    said.push(JSON.stringify(events.filter((e) => e.type === "node:warning")));
    for (const text of said) expect(text).not.toContain(secret);
  });

  it("an output too deep to check fails that node, never the run (recursive $ref)", async () => {
    const schema: JSONSchema = {
      $defs: { link: { type: "object", properties: { next: { $ref: "#/$defs/link" } } } },
      type: "object",
      properties: { chain: { $ref: "#/$defs/link" } },
    };
    let tail: Record<string, unknown> = {};
    const chain = tail;
    for (let i = 0; i < 100_000; i++) {
      const next: Record<string, unknown> = {};
      tail.next = next;
      tail = next;
    }
    const { claude } = scripted([{ chain }]);
    const { results } = await execute(
      oneNode(schema),
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        logger: silent,
      },
    );
    expect(results.get("review")?.status).toBe("failed");
    expect(results.get("review")?.data.error).toBe(
      "output schema violation: (output): not checked: the output nests deeper than 64 levels",
    );
  });

  it("a check that throws fails that node with an output validation error, with no repair", async () => {
    // Throws only inside the contract check, so the rest of the executor can still read it.
    const hostile = {
      get verdict(): string {
        if (/outputContractProblems/.test(new Error().stack ?? "")) throw new Error("getter exploded");
        return "pass";
      },
    };
    const instructions: string[] = [];
    const claude: Claude = {
      async run(opts): Promise<NodeResult> {
        instructions.push(opts.instruction);
        return { status: "success", data: hostile as unknown as Record<string, unknown>, toolCalls: [] };
      },
      async evaluate() {
        return null;
      },
      async ask() {
        return "";
      },
    };
    const { results } = await execute(
      oneNode(FINDINGS),
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        logger: silent,
      },
    );
    expect(instructions).toHaveLength(1);
    expect(results.get("review")?.status).toBe("failed");
    expect(results.get("review")?.data.error).toBe("output validation error: getter exploded");
    expect(results.get("review")?.evals).toEqual([
      { name: "output_schema", kind: "value", pass: false, reasoning: "output validation error: getter exploded" },
    ]);
  });

  it("caps the paths in the log line and the event at 20, then counts the rest", async () => {
    const schema: JSONSchema = { type: "object", additionalProperties: { type: "string" } };
    const data = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
    const lines: string[] = [];
    const logger: Logger = { ...silent, warn: (m) => void lines.push(String(m)) };
    const events: ExecutionEvent[] = [];
    const { claude } = scripted([data]);
    await execute(
      oneNode(schema),
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        logger,
        observer: (e) => events.push(e),
      },
    );
    const paths = Array.from({ length: 20 }, (_, i) => `k${i}`);
    expect(lines[0]).toBe(`  output contract: ${[...paths, "and 5 more"].join(", ")}; asking the agent once to fix it`);
    expect(events).toContainEqual(expect.objectContaining({ type: "node:warning", fields: [...paths, "and 5 more"] }));
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
    expect(outputSchemaError(schema)).toBeUndefined();
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

describe("validateWorkflow: a schema that does not compile still loads, with a deprecation warning (#573)", () => {
  const warn = (schema: JSONSchema) => {
    const warnings: WorkflowWarning[] = [];
    const errors = validateWorkflow(oneNode(schema), undefined, { warnings });
    return { errors, warnings };
  };
  const message = (why: string) =>
    `Node "review" declares an output schema the validator cannot compile (${why}). ` +
    "Its output gets only the old top-level check (required fields, top-level types and enums). " +
    "Deprecated: a future minor will refuse to load this workflow; fix the schema or name its draft in $schema.";

  it.each<[string, JSONSchema, string]>([
    [
      "tuple items without $schema",
      { type: "object", properties: { pair: { type: "array", items: [{ type: "string" }] } } },
      "schema is invalid: data/properties/pair/items must be object,boolean",
    ],
    [
      "an unresolvable $ref",
      { type: "object", properties: { n: { $ref: "#/$defs/missing" } } },
      "can't resolve reference #/$defs/missing from id #",
    ],
    [
      "property-level required: true",
      { type: "object", properties: { a: { type: "string", required: true } } },
      "schema is invalid: data/properties/a/required must be array",
    ],
    [
      "an unknown type",
      { type: "object", properties: { n: { type: "str" } } },
      "schema is invalid: data/properties/n/type must be equal to one of the allowed values, " +
        "data/properties/n/type must be array, data/properties/n/type must match a schema in anyOf",
    ],
  ])("%s: no error, one warning naming the node and the validator's message", (_label, schema, why) => {
    expect(warn(schema)).toEqual({
      errors: [],
      warnings: [{ code: "OUTPUT_SCHEMA_FALLBACK", nodeId: "review", message: message(why) }],
    });
  });

  it("draft-04 and draft-06 schemas compile: no warning", () => {
    expect(warn({ $schema: "http://json-schema.org/draft-04/schema#", type: "object" }).warnings).toEqual([]);
    expect(warn({ $schema: "http://json-schema.org/draft-06/schema#", type: "object" }).warnings).toEqual([]);
  });

  it("without a sink, validateWorkflow returns the same errors (none) as before", () => {
    expect(validateWorkflow(oneNode({ type: "object", properties: { n: { type: "str" } } }))).toEqual([]);
  });

  it("the loader still loads it, and carries the warning", () => {
    const wf = oneNode({ type: "object", properties: { n: { type: "str" } } });
    const r = validateParsed(JSON.parse(JSON.stringify(wf)));
    expect(r.ok).toBe(true);
    expect(r.ok && r.warnings).toEqual([
      expect.stringMatching(
        /^OUTPUT_SCHEMA_FALLBACK: Node "review" declares an output schema the validator cannot compile/,
      ),
    ]);
  });

  it("a valid schema, or none, is neither an error nor a warning", () => {
    expect(warn(FINDINGS)).toEqual({ errors: [], warnings: [] });
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
      ["pair", "pair[1]", "invalid", "expected number"],
    ]);
  });

  it("2020-12, the default, does not compile array-form items: the top-level fallback, each complaint once", () => {
    expect(outputSchemaError(TUPLE)).toBe("schema is invalid: data/properties/pair/items must be object,boolean");
    expect(rows({ pair: ["a", "b"] }, TUPLE)).toEqual([]);
    expect(rows({ pair: "ab" }, TUPLE)).toEqual([["pair", "pair", "invalid", "expected array"]]);
    expect(contractProblems({ pair: "ab" }, TUPLE)[0].fallback).toBe(true);
  });

  it("draft-04: id, boolean exclusiveMaximum", () => {
    const schema = {
      $schema: "http://json-schema.org/draft-04/schema#",
      id: "https://example.com/d4",
      type: "object",
      properties: { n: { type: "number", maximum: 10, exclusiveMaximum: true } },
      required: ["n", "q"],
    };
    expect(rows({ n: 10 }, schema)).toEqual([
      ["q", "q", "missing", "required but missing"],
      ["n", "n", "invalid", "must be < 10"],
    ]);
    expect(rows({ n: 9, q: 1 }, schema)).toEqual([]);
  });

  it("draft-06: const and contains, on ajv's own draft-06 meta-schema", () => {
    const schema = {
      $schema: "http://json-schema.org/draft-06/schema#",
      type: "object",
      properties: { a: { type: "array", contains: { type: "string" } }, c: { const: 3 } },
    };
    expect(rows({ a: [1], c: 2 }, schema)).toEqual([
      ["a", "a[0]", "invalid", "expected string"],
      ["a", "a", "invalid", "must contain at least 1 valid item(s)"],
      ["c", "c", "invalid", "expected 3"],
    ]);
  });

  it("the vendored draft-06 meta-schema is ajv's copy", () => {
    const ajvCopy = createRequire(import.meta.url)("ajv/dist/refs/json-schema-draft-06.json");
    expect(DRAFT_06_META_SCHEMA).toEqual(ajvCopy);
  });

  it("2019-09 reads tuples and dependentRequired; draft-07 does not know dependentRequired", () => {
    const schema = { ...TUPLE, $schema: DRAFT_2019, dependentRequired: { pair: ["why"] } };
    expect(rows({ pair: ["a", "b"] }, schema)).toEqual([
      ["pair", "pair[1]", "invalid", "expected number"],
      ["why", "why", "invalid", "required when 'pair' is present, but missing"],
    ]);
    expect(rows({ pair: ["a", "b"] }, { ...schema, $schema: DRAFT_07 })).toEqual([
      ["pair", "pair[1]", "invalid", "expected number"],
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
      ["n", "n", "invalid", "expected string or number"],
    ],
    [
      "a rule on null keeps only the wording",
      { n: null },
      { type: "object", properties: { n: { not: { type: "null" } } } },
      ["n", "n", "invalid", "must NOT be valid"],
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
      ["s", "s", "invalid", `expected "${"x".repeat(78)}"`],
    ],
    [
      "a longer value is cut to 77 characters and an ellipsis",
      { s: 1 },
      { type: "object", properties: { s: { const: "x".repeat(79) } } },
      ["s", "s", "invalid", `expected "${"x".repeat(76)}...`],
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
      ["m", "m[1][1]", "invalid", "expected number"],
      ["l", "l[10]", "invalid", "expected number"],
      ["o", "o.deep.v", "invalid", "expected string"],
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

  it("no schema (or one that is not an object) checks nothing; an array schema falls back to checking nothing", () => {
    expect(contractProblems({ a: 1 }, undefined)).toEqual([]);
    expect(rows({ a: 1 }, "x")).toEqual([]);
    expect(rows({}, [])).toEqual([]);
    expect(outputSchemaError([] as unknown as JSONSchema)).toBe("schema is invalid: data must be object,boolean");
  });

  it.each<[string, unknown[], unknown[]]>([
    ["number", [0, 1.5, -2], [Infinity, NaN, "1", null]],
    ["integer", [0, 3, -4], [1.5, "1", null]],
    ["string", ["", "s"], [1, null, ["s"]]],
    ["boolean", [true, false], ["true", 0, null]],
    ["array", [[], [1]], [{}, "[]", null]],
    ["object", [{}, { a: 1 }], [[], null, "s", 1]],
    ["null", [null], [0, "", {}]],
    ["mystery", [1, "s", null, {}], []],
  ])("the fallback's type %s: accepts %j, rejects %j", (type, good, bad) => {
    // The `$ref` to nowhere keeps the schema from compiling, so the fallback runs.
    const schema = { type: "object", properties: { bad: { $ref: "#/$defs/nope" }, v: { type } } };
    for (const v of good) expect(rows({ v }, schema), JSON.stringify(v)).toEqual([]);
    for (const v of bad)
      expect(rows({ v }, schema), JSON.stringify(v)).toEqual([["v", "v", "invalid", `expected ${type}`]]);
  });

  it("the fallback reads malformed property schemas without failing, and skips absent fields", () => {
    const schema = {
      type: "object",
      properties: { bad: { $ref: "#/$defs/nope" }, gone: { type: "string" }, nil: null, word: "string", yes: true },
    };
    expect(rows({ nil: 1, word: 1, yes: 1 }, schema)).toEqual([]);
    expect(rows({ summary: "s" }, { properties: null, required: ["a"] })).toEqual([
      ["a", "a", "missing", "required but missing"],
    ]);
    expect(rows({ a: 1 }, { properties: "ab", required: "a" })).toEqual([]);
  });

  it("the fallback: required, top-level type (number finite, integer, null, object, union) and enum only", () => {
    // `$ref` to nowhere: the schema does not compile, so only the top level is read.
    const schema = {
      type: "object",
      properties: {
        bad: { $ref: "#/$defs/nope" },
        num: { type: "number" },
        int: { type: "integer" },
        nul: { type: "null" },
        obj: { type: "object" },
        arr: { type: "array", items: { type: "string" } },
        bool: { type: "boolean" },
        str: { type: "string" },
        union: { type: ["string", "null"] },
        pick: { enum: ["a", "b"] },
        typed: { type: "string", enum: ["x"] },
        free: {},
        flag: true,
      },
      required: ["num", "absent", 3],
    };
    const ok = {
      num: 1,
      int: 2,
      nul: null,
      obj: {},
      arr: [1],
      bool: false,
      str: "s",
      union: null,
      pick: "a",
      typed: "x",
    };
    expect(rows({ ...ok, bad: "anything", free: 1, flag: 1 }, schema)).toEqual([
      ["absent", "absent", "missing", "required but missing"],
    ]);
    const wrong = {
      num: Infinity,
      int: 1.5,
      nul: 0,
      obj: [],
      arr: {},
      bool: "no",
      str: 1,
      union: 1,
      pick: "c",
      typed: "y",
    };
    expect(rows(wrong, schema)).toEqual([
      ["absent", "absent", "missing", "required but missing"],
      ["num", "num", "invalid", "expected number"],
      ["int", "int", "invalid", "expected integer"],
      ["nul", "nul", "invalid", "expected null"],
      ["obj", "obj", "invalid", "expected object"],
      ["arr", "arr", "invalid", "expected array"],
      ["bool", "bool", "invalid", "expected boolean"],
      ["str", "str", "invalid", "expected string"],
      ["union", "union", "invalid", "expected string or null"],
      ["pick", "pick", "invalid", 'expected one of ["a","b"]'],
      ["typed", "typed", "invalid", 'expected one of ["x"]'],
    ]);
    expect(contractProblems(wrong, schema as JSONSchema).every((p) => p.fallback === true)).toBe(true);
  });

  it("the fallback still checks x-sweny-count-of, marked as fallback", () => {
    const schema = {
      type: "object",
      properties: {
        bad: { $ref: "#/$defs/nope" },
        items: { type: "array" },
        n: { type: "integer", [COUNT_OF_KEYWORD]: { array: "items" } },
      },
    };
    expect(contractProblems({ items: [{}], n: 2 }, schema as JSONSchema)).toEqual([
      {
        field: "n",
        path: "n",
        kind: "invalid",
        problem: "does not match the count: 'items' has 1 matching item(s)",
        fallback: true,
      },
    ]);
    expect(rows({ items: [{}], n: "2" }, schema)).toEqual([["n", "n", "invalid", "expected integer"]]);
  });

  it("output deeper than the cap, or bigger, is a problem in itself, checked without recursion", () => {
    expect(MAX_OUTPUT_DEPTH).toBe(64);
    expect(MAX_OUTPUT_VALUES).toBe(100_000);
    const nest = (levels: number) => {
      const root: Record<string, unknown> = {};
      let cur = root;
      for (let i = 0; i < levels; i++) {
        const next: Record<string, unknown> = {};
        cur.next = next;
        cur = next;
      }
      return root;
    };
    expect(rows(nest(64), { type: "object" })).toEqual([]);
    expect(rows(nest(65), { type: "object" })).toEqual([
      [ROOT_PATH, ROOT_PATH, "invalid", "not checked: the output nests deeper than 64 levels"],
    ]);
    expect(rows({ l: Array.from({ length: 99_998 }, () => 1) }, { type: "object" })).toEqual([]);
    expect(rows({ l: Array.from({ length: 99_999 }, () => 1) }, { type: "object" })).toEqual([
      [ROOT_PATH, ROOT_PATH, "invalid", "not checked: the output holds more than 100000 values"],
    ]);
  });

  it("checkOutputContract returns the problems, or why the check could not run", () => {
    expect(checkOutputContract({ n: "x" }, { type: "object", properties: { n: { type: "number" } } })).toEqual({
      problems: [{ field: "n", path: "n", kind: "invalid", problem: "expected number" }],
    });
    const hostile = Object.defineProperty({}, "n", {
      enumerable: true,
      get() {
        throw new Error("no");
      },
    });
    expect(checkOutputContract(hostile, { type: "object" })).toEqual({ error: "no" });
    const odd = Object.defineProperty({}, "n", {
      enumerable: true,
      get() {
        throw "a string";
      },
    });
    expect(checkOutputContract(odd, { type: "object" })).toEqual({ error: "a string" });
    const many = Array.from({ length: 21 }, (_, i) => ({
      field: "f",
      path: `p${i}`,
      kind: "invalid" as const,
      problem: "x",
    }));
    expect(contractPaths(many)).toEqual([...Array.from({ length: 20 }, (_, i) => `p${i}`), "and 1 more"]);
  });

  it("a summary the schema only requires is kept; one it does not name is dropped", () => {
    expect(rows({ summary: "s" }, { type: "object", required: ["summary"] })).toEqual([]);
    expect(rows({ summary: "s" }, { type: "object", additionalProperties: false })).toEqual([]);
    expect(rows({ summary: 1 }, { type: "object", properties: { summary: { type: "string" } } })).toEqual([
      ["summary", "summary", "invalid", "expected string"],
    ]);
  });

  it("the same schema object gives the same answer every time", () => {
    const schema = { type: "object", properties: { n: { type: "number" } } };
    expect(rows({ n: "1" }, schema)).toEqual(rows({ n: "1" }, schema));
    expect(rows({ n: 1 }, schema)).toEqual([]);
  });

  it("outputSchemaError: undefined for none or a valid schema, the deduplicated message otherwise", () => {
    expect(outputSchemaError(undefined)).toBeUndefined();
    expect(outputSchemaError("x" as unknown as JSONSchema)).toBeUndefined();
    expect(outputSchemaError(5 as unknown as JSONSchema)).toBeUndefined();
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
      ["n", "n", "invalid", "does not match the count: 'items' has 2 matching item(s)"],
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
      ["n", "n", "invalid", "does not match the count: 'items' has 1 matching item(s)"],
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
      ["n", "n", "invalid", "does not match the count: 'items' has 1 matching item(s)"],
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
    expect(contractFailureMessage([p("x.y"), p("a", "missing"), p("(output)", "invalid", "cannot")])).toBe(
      "output schema violation: required field(s) missing from emitted data: a; x.y: bad; (output): cannot",
    );
    const missing = Array.from({ length: 22 }, (_, i) => p(`m${i}`, "missing"));
    expect(contractFailureMessage(missing)).toMatch(/: m0, m1, .*, m19, and 2 more$/);
    expect(contractFailureMessage([p("x[0]")])).toBe("output schema violation: x[0]: bad");
  });

  it("caps the node error the same way", () => {
    const many = Array.from({ length: 21 }, (_, i) => p(`k${i}`));
    expect(contractFailureMessage(many)).toMatch(/; k19: bad; and 1 more$/);
  });
});
