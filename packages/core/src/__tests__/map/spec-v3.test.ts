/**
 * Spec v3 and the map node's static half (#575, RFC 0002 M1, milestone 1):
 * the identity v2 -> v3 migration, the map node schema (Zod and the published
 * JSON schema agree), load-time checks, and child workflow files.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Ajv2020 } from "ajv/dist/2020.js";

import { CURRENT_SPEC_VERSION, MIGRATIONS, assertRegistryValid, migrateWorkflow } from "../../migrations.js";
import { validateParsed, loadAndValidateWorkflow } from "../../loader.js";
import { workflowZ, workflowJsonSchema, validateWorkflow, isAgentNode } from "../../schema.js";
import { workflowHashOf } from "../../journal.js";
import { MAP_OUTPUT_SCHEMA, childWorkflowOf, itemKeyOf, withMapOutputs } from "../../map-spec.js";
import type { Workflow } from "../../types.js";

const CHILD = {
  entry: "draft",
  nodes: {
    draft: {
      name: "Draft",
      instruction: "Draft a prompt for the item.",
      output: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
    },
  },
  edges: [],
};

function mapWorkflow(map: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    id: "todos",
    name: "Todos",
    spec_version: "3",
    entry: "list",
    nodes: {
      list: {
        name: "List",
        instruction: "List the todos.",
        output: { type: "object", required: ["items"], properties: { items: { type: "array" } } },
      },
      draft_all: {
        kind: "map",
        name: "Draft all",
        over: "list.items",
        key: "id",
        workflow: CHILD,
        result: "draft",
        ...map,
      },
    },
    edges: [{ from: "list", to: "draft_all" }],
    ...extra,
  };
}

const errorsOf = (raw: unknown) => {
  const r = validateParsed(raw);
  return r.ok ? [] : r.errors.map((e) => e.message);
};

describe("spec v3 (#575)", () => {
  it("is the current version, reached from v2 by an identity step", () => {
    expect(CURRENT_SPEC_VERSION).toBe(3);
    expect(MIGRATIONS.map((m) => [m.from, m.to])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(MIGRATIONS[1].identity).toBe(true);
    expect(() => assertRegistryValid({ current: 3, migrations: MIGRATIONS })).not.toThrow();
  });

  it("migrates a v2 file to v3 unchanged, and says nothing about it", () => {
    const v2 = {
      id: "w",
      name: "W",
      spec_version: "2",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x" } },
      edges: [],
    };
    const m = migrateWorkflow(v2);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.workflow).toEqual({ ...v2, spec_version: "3" });
    expect([m.from, m.to, m.changed]).toEqual([2, 3, false]);
    const r = validateParsed(v2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toBeUndefined();
      expect(r.workflow.spec_version).toBe("3");
    }
  });

  it("still warns once for a v1 file, naming the current version", () => {
    const r = validateParsed({
      id: "w",
      name: "W",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x" } },
      edges: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings?.[0]).toBe(
        'Workflow uses spec_version "1" (current is "3"); migrated in memory for this run. ' +
          "Run `sweny workflow upgrade <file>` to update the file.",
      );
    }
  });

  it("the v2 -> v3 step changes the workflow hash (a pre-v3 journal does not resume)", () => {
    const wf = { id: "w", name: "W", description: "", entry: "a", nodes: {}, edges: [] } as unknown as Workflow;
    expect(workflowHashOf({ ...wf, spec_version: "3" })).not.toBe(workflowHashOf({ ...wf, spec_version: "2" }));
  });

  it("refuses a map node in a v2 file, and in a file with no spec_version, before anything else", () => {
    const v2 = errorsOf(mapWorkflow({}, { spec_version: "2" }));
    expect(v2).toEqual([
      'node "draft_all" is a map node (kind: map), which needs spec_version "3", but this file declares ' +
        'spec_version "2". Set spec_version: "3" (run `sweny workflow upgrade <file>` first if it is older).',
    ]);
    const { spec_version: _drop, ...none } = mapWorkflow();
    expect(errorsOf(none)).toEqual([
      'node "draft_all" is a map node (kind: map), which needs spec_version "3", but this file declares ' +
        'no spec_version (so "1"). Set spec_version: "3" (run `sweny workflow upgrade <file>` first if it is older).',
    ]);
    const r = validateParsed(mapWorkflow({}, { spec_version: "2" }));
    expect(!r.ok && r.errors[0].code).toBe("SPEC_VERSION");
  });

  it("refuses a map node in a workflow built in code below v3", () => {
    const wf = workflowZ.parse(mapWorkflow()) as Workflow;
    const errs = validateWorkflow({ ...wf, spec_version: "2" });
    expect(errs.map((e) => [e.code, e.message])).toContainEqual([
      "INVALID_MAP",
      'Map node "draft_all" needs spec_version "3"; this workflow runs as spec_version "2"',
    ]);
  });
});

describe("the map node schema", () => {
  it("parses a map node: no instruction, skills [], the map fields as written", () => {
    const r = validateParsed(mapWorkflow({ concurrency: 2, max_items: 10, with: { team: "input.team" } }));
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
    const n = r.workflow.nodes.draft_all;
    expect(n.kind).toBe("map");
    expect(n.instruction).toBeUndefined();
    expect(n.skills).toEqual([]);
    expect([n.over, n.key, n.result, n.concurrency, n.max_items]).toEqual(["list.items", "id", "draft", 2, 10]);
    expect(n.with).toEqual({ team: "input.team" });
    expect(r.warnings).toBeUndefined();
  });

  it("isAgentNode narrows a raw workflowZ parse back to agent-node fields", () => {
    const parsed = workflowZ.parse(mapWorkflow());
    const list = parsed.nodes.list;
    expect(isAgentNode(list)).toBe(true);
    // Only typechecks once narrowed: a raw parse types each node as agent | map.
    if (isAgentNode(list)) expect(list.instruction).toBe("List the todos.");
    expect(isAgentNode(parsed.nodes.draft_all)).toBe(false);
    expect(isAgentNode({ kind: "agent" })).toBe(true);
    expect(isAgentNode({})).toBe(true);
  });

  it("an agent node may say kind: agent", () => {
    const wf = mapWorkflow();
    (wf.nodes.list as Record<string, unknown>).kind = "agent";
    expect(errorsOf(wf)).toEqual([]);
  });

  it.each([
    ["no result", { result: undefined }, "nodes.draft_all.result"],
    ["no key", { key: undefined }, "nodes.draft_all.key"],
    ["no workflow", { workflow: undefined }, "nodes.draft_all.workflow"],
    ["an instruction", { instruction: "x" }, 'Unrecognized key: "instruction"'],
    ["outputs on the map", { outputs: [{ type: "comment" }] }, 'Unrecognized key: "outputs"'],
    ["skills", { skills: ["github"] }, "a map node has no skills"],
    ["concurrency 17", { concurrency: 17 }, "nodes.draft_all.concurrency"],
    ["concurrency 0", { concurrency: 0 }, "nodes.draft_all.concurrency"],
    ["max_items 1001", { max_items: 1001 }, "nodes.draft_all.max_items"],
    ["an unknown on_item_fail", { on_item_fail: "ignore" }, "nodes.draft_all.on_item_fail"],
    ["min_success 0", { min_success: 0, on_item_fail: "collect" }, "nodes.draft_all.min_success"],
    ["isolation evidence (M3)", { isolation: "evidence" }, "nodes.draft_all.isolation"],
  ])("refuses %s", (_label, patch, expected) => {
    const errs = errorsOf(mapWorkflow(patch));
    expect(errs.join("\n")).toContain(expected);
  });

  it("refuses map fields on an agent node", () => {
    const wf = mapWorkflow();
    (wf.nodes.list as Record<string, unknown>).over = "input.x";
    expect(errorsOf(wf).join("\n")).toContain('Unrecognized key: "over"');
  });

  it("accepts the ceilings exactly", () => {
    expect(errorsOf(mapWorkflow({ concurrency: 16, max_items: 1000 }))).toEqual([]);
  });
});

describe("map load-time checks", () => {
  const msg = (m: string) => `Map node "draft_all" ${m}`;
  it.each([
    [
      "both over and items",
      { items: [{ id: "a" }] },
      msg("must declare exactly one of `over` (a path to an array) and `items` (a literal list)"),
    ],
    [
      "neither over nor items",
      { over: undefined },
      msg("must declare exactly one of `over` (a path to an array) and `items` (a literal list)"),
    ],
    [
      "an over that is not a path",
      { over: "items" },
      msg('over "items" is not a path: write input.<field> or <node>.<field>'),
    ],
    [
      "an over naming an unknown node",
      { over: "nope.items" },
      msg('over "nope.items" names node "nope", which this workflow does not have'),
    ],
    [
      "an over reading itself",
      { over: "draft_all.items" },
      msg('over "draft_all.items" reads the map node\'s own output'),
    ],
    [
      "an over field the source does not declare",
      { over: "list.todos" },
      msg('over "list.todos" reads list.todos, which node "list" does not declare in its output'),
    ],
    ["a key that is not a field", { key: "a.b" }, msg('key "a.b" must be an item field name or $index')],
    ["min_success without collect", { min_success: 2 }, msg("sets min_success, which needs on_item_fail: collect")],
    [
      "a with naming item",
      { with: { item: "input.x" } },
      msg('with: "item" is not a child input name (letters, digits, _; not item or item_key)'),
    ],
    [
      "a with path to an unknown node",
      { with: { team: "ghost.team" } },
      msg('with.team "ghost.team" names node "ghost", which this workflow does not have'),
    ],
    ["a result that is not a child node", { result: "nope" }, msg('result "nope" is not a node of its child workflow')],
  ])("refuses %s", (_label, patch, expected) => {
    expect(errorsOf(mapWorkflow(patch))).toContain(expected);
  });

  it("checks literal items: count, keys and duplicates", () => {
    const literal = { over: undefined, key: "id" };
    expect(errorsOf(mapWorkflow({ ...literal, items: [{ id: "a" }, { id: "a" }] }))).toEqual([
      msg('has two items with key "a"; keys must be unique'),
    ]);
    expect(errorsOf(mapWorkflow({ ...literal, items: [{ id: "a b" }] }))).toEqual([
      msg('item 0 key "a b" must match ^[A-Za-z0-9_-]{1,64}$'),
    ]);
    expect(errorsOf(mapWorkflow({ ...literal, items: [{ name: "x" }] }))).toEqual([
      msg('item 0 has no string or integer "id" to key it by'),
    ]);
    expect(errorsOf(mapWorkflow({ ...literal, max_items: 1, items: [{ id: "a" }, { id: "b" }] }))).toEqual([
      msg("lists 2 items, more than max_items (1)"),
    ]);
    expect(errorsOf(mapWorkflow({ ...literal, items: [{ id: "a" }, { id: 7 }] }))).toEqual([]);
    expect(errorsOf(mapWorkflow({ over: undefined, key: "$index", items: ["x", "y"] }))).toEqual([]);
  });

  it("refuses a nested map, child outputs and child write permissions", () => {
    const nested = {
      ...CHILD,
      nodes: {
        ...CHILD.nodes,
        inner: { kind: "map", name: "I", items: [], key: "$index", workflow: CHILD, result: "draft" },
      },
    };
    expect(errorsOf(mapWorkflow({ workflow: nested })).join("\n")).toContain("nodes.draft_all.workflow");
    const outputs = { ...CHILD, nodes: { draft: { ...CHILD.nodes.draft, outputs: [{ type: "comment" }] } } };
    expect(errorsOf(mapWorkflow({ workflow: outputs }))).toContain(
      msg('runs a child workflow whose node "draft" declares outputs, which needs on_item_fail: collect'),
    );
    // #576: with collect, a child may request writes; its map plans them per item.
    expect(errorsOf(mapWorkflow({ workflow: outputs, on_item_fail: "collect" })).join("\n")).not.toContain(
      "declares outputs",
    );
    const write = { ...CHILD, nodes: { draft: { ...CHILD.nodes.draft, permissions: "write" } } };
    expect(errorsOf(mapWorkflow({ workflow: write }))).toContain(
      msg('runs a child workflow whose node "draft" declares write permissions; children are read-only in M1'),
    );
    const wfWrite = { ...CHILD, permissions: "write" };
    expect(errorsOf(mapWorkflow({ workflow: wfWrite }))).toContain(
      msg("runs a child workflow that declares write permissions; children are read-only in M1"),
    );
  });

  it("validates the child as a workflow of its own, prefixed with the map node", () => {
    const broken = { ...CHILD, entry: "missing" };
    expect(errorsOf(mapWorkflow({ workflow: broken }))).toContain(
      'Map node "draft_all" child workflow: Entry node "missing" does not exist',
    );
  });

  it("routes on the derived output: counts and results validate in a when expression", () => {
    const wf = mapWorkflow();
    (wf.nodes as Record<string, unknown>).store = { name: "Store", instruction: "Store the prompts." };
    wf.edges.push({ from: "draft_all", to: "store", when: { expr: "draft_all.counts.failed == 0" } } as never);
    expect(errorsOf(wf)).toEqual([]);
    const bad = mapWorkflow();
    (bad.nodes as Record<string, unknown>).store = { name: "Store", instruction: "Store." };
    bad.edges.push({ from: "draft_all", to: "store", when: { expr: "draft_all.nope == 0" } } as never);
    expect(errorsOf(bad).join("\n")).toContain("draft_all.nope");
  });
});

describe("map helpers", () => {
  it("derives the map output schema and leaves agent nodes alone", () => {
    const wf = workflowZ.parse(mapWorkflow()) as Workflow;
    const out = withMapOutputs(wf);
    expect(out.nodes.draft_all.output).toBe(MAP_OUTPUT_SCHEMA);
    expect(out.nodes.list).toBe(wf.nodes.list);
    expect(wf.nodes.draft_all.output).toBeUndefined();
    expect(MAP_OUTPUT_SCHEMA.required).toEqual(["items", "order", "results", "counts"]);
    const noMap = { ...wf, nodes: { list: wf.nodes.list } };
    expect(withMapOutputs(noMap)).toBe(noMap);
  });

  it("builds the child workflow: the map node's id and name, the parent's version, a read ceiling", () => {
    const wf = workflowZ.parse(mapWorkflow()) as Workflow;
    const child = childWorkflowOf({ ...wf, skills: { notes: { instruction: "n" } }, model: "m" }, "draft_all")!;
    expect([child.id, child.name, child.description, child.spec_version, child.model]).toEqual([
      "todos.draft_all",
      "Draft all",
      "",
      "3",
      "m",
    ]);
    expect(child.permissions).toBe("read");
    expect(child.skills).toEqual({ notes: { instruction: "n" } });
    expect(child.entry).toBe("draft");
    expect(childWorkflowOf(wf, "list")).toBeUndefined();
    const narrowed = childWorkflowOf(
      {
        ...wf,
        nodes: {
          ...wf.nodes,
          draft_all: { ...wf.nodes.draft_all, workflow: { ...CHILD, permissions: { deny: ["shell"] } } as never },
        },
      },
      "draft_all",
    )!;
    expect(narrowed.permissions).toEqual({ deny: ["shell"], access: "read" });
  });

  it("keys items by field or by index", () => {
    expect(itemKeyOf({ id: "a-1" }, 0, "id")).toBe("a-1");
    expect(itemKeyOf({ id: 42 }, 0, "id")).toBe("42");
    expect(itemKeyOf("x", 3, "$index")).toBe("3");
    expect(itemKeyOf({ id: 1.5 }, 2, "id")).toEqual({ error: 'item 2 has no string or integer "id" to key it by' });
    expect(itemKeyOf({ id: "x".repeat(65) }, 0, "id")).toEqual({
      error: `item 0 key "${"x".repeat(65)}" must match ^[A-Za-z0-9_-]{1,64}$`,
    });
    expect(itemKeyOf(null, 0, "id")).toEqual({ error: 'item 0 has no string or integer "id" to key it by' });
  });
});

describe("child workflow files", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "sweny-map-"));
    dirs.push(dir);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, "utf-8");
    return dir;
  };
  const PARENT = `spec_version: "3"
id: todos
name: Todos
entry: draft_all
nodes:
  draft_all:
    kind: map
    name: Draft all
    items: [{ id: a }, { id: b }]
    key: id
    workflow: ./draft-one.yml
    result: draft
edges: []
`;
  const CHILD_FILE = `spec_version: "3"
id: draft-one
name: Draft one
entry: draft
nodes:
  draft:
    name: Draft
    instruction: Draft a prompt.
edges: []
`;

  it("reads the child file relative to the parent and inlines it", () => {
    const dir = tmp({ "parent.yml": PARENT, "draft-one.yml": CHILD_FILE });
    const r = loadAndValidateWorkflow(join(dir, "parent.yml"));
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
    const child = r.workflow.nodes.draft_all.workflow;
    expect(typeof child).toBe("object");
    expect((child as Workflow).id).toBe("draft-one");
    expect((child as Workflow).nodes.draft.instruction).toBe("Draft a prompt.");
  });

  it("prefixes the child file's own errors with the map node", () => {
    const dir = tmp({ "parent.yml": PARENT });
    const r = loadAndValidateWorkflow(join(dir, "parent.yml"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].message.startsWith('Map node "draft_all" workflow "./draft-one.yml": Could not read')).toBe(
        true,
      );
      expect(r.errors[0].code).toBe("IO");
      expect(r.errors[0].nodeId).toBe("draft_all");
    }
  });

  it("refuses a child file that itself maps (no nested maps)", () => {
    const nested = CHILD_FILE.replace(
      "edges: []",
      `  inner:
    kind: map
    name: Inner
    items: [1]
    key: $index
    workflow: { entry: d, nodes: { d: { name: D, instruction: x } }, edges: [] }
    result: d
edges:
  - { from: draft, to: inner }`,
    );
    const dir = tmp({ "parent.yml": PARENT, "draft-one.yml": nested });
    const r = loadAndValidateWorkflow(join(dir, "parent.yml"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.message)).toContain(
        'Map node "draft_all" runs a child workflow with a map node ("inner"); nested maps are not supported',
      );
    }
  });

  it("without a parent file the path cannot be read, and validation says so", () => {
    const raw = mapWorkflow({ workflow: "./draft-one.yml" });
    expect(errorsOf(raw)).toContain(
      'Map node "draft_all" names the workflow file "./draft-one.yml", which was not read: load the workflow from its file',
    );
  });
});

// The Zod parser and the published JSON schema agree on map nodes (Fix #4 pattern).
describe("map nodes: Zod and the JSON schema agree", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(workflowJsonSchema);
  const cases: Array<[string, unknown, boolean]> = [
    ["a map node over a path", mapWorkflow(), true],
    [
      "a map node with literal items and every option",
      mapWorkflow({
        over: undefined,
        items: [{ id: "a" }],
        concurrency: 16,
        max_items: 1000,
        on_item_fail: "collect",
        min_success: 1,
        on_empty: "fail",
        item_budget: { tokens: 10 },
        isolation: "inputs",
        with: { t: "input.t" },
        on_fail: "continue",
        skills: [],
      }),
      true,
    ],
    ["min_success all", mapWorkflow({ min_success: "all" }), true],
    ["a workflow file path", mapWorkflow({ workflow: "./x.yml" }), true],
    [
      "an agent node with kind agent",
      { ...mapWorkflow(), nodes: { a: { kind: "agent", name: "A", instruction: "x" } } },
      true,
    ],
    ["a map node with an instruction", mapWorkflow({ instruction: "x" }), false],
    ["a map node with skills", mapWorkflow({ skills: ["github"] }), false],
    ["a map node with retry", mapWorkflow({ retry: { max: 1 } }), false],
    ["a map node with no result", mapWorkflow({ result: undefined }), false],
    ["a map node with concurrency 17", mapWorkflow({ concurrency: 17 }), false],
    ["a map node with max_items 0", mapWorkflow({ max_items: 0 }), false],
    ["a map node with an unknown key", mapWorkflow({ fan: 2 }), false],
    ["a map node with isolation evidence", mapWorkflow({ isolation: "evidence" }), false],
    [
      "an agent node with over",
      { ...mapWorkflow(), nodes: { a: { name: "A", instruction: "x", over: "input.x" } } },
      false,
    ],
    ["an agent node with no instruction", { ...mapWorkflow(), nodes: { a: { name: "A" } } }, false],
    ["an unknown kind", { ...mapWorkflow(), nodes: { a: { kind: "loop", name: "A", instruction: "x" } } }, false],
    [
      "a child workflow with a map node",
      mapWorkflow({ workflow: { ...CHILD, nodes: { m: { kind: "map", name: "M" } } } }),
      false,
    ],
    ["a child workflow with an unknown key", mapWorkflow({ workflow: { ...CHILD, extra: 1 } }), false],
    ["a child workflow without edges", mapWorkflow({ workflow: { entry: "draft", nodes: CHILD.nodes } }), false],
  ];
  it.each(cases)("%s", (_label, input, expected) => {
    const zod = workflowZ.safeParse(input).success;
    const json = validate(input) as boolean;
    expect({ zod, json }).toEqual({ zod: expected, json: expected });
  });
});
