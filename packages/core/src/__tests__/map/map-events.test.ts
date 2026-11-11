/**
 * Map events (#575, RFC 0002 M1, milestone 6): versioned map:start,
 * child:start, child:end and map:end on the parent's observer, and each
 * child's own events scoped to its run.
 */
import { describe, it, expect } from "vitest";

import { execute } from "../../executor.js";
import { createMemoryChildHost } from "../../child-host.js";
import { EVENTS_VERSION, type Claude, type ExecutionEvent, type Node, type Workflow } from "../../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const CHILD = {
  entry: "draft",
  nodes: { draft: { name: "Draft", instruction: "Draft.", skills: [] } },
  edges: [],
};

function workflow(map: Partial<Node> = {}): Workflow {
  return {
    id: "p",
    name: "P",
    description: "",
    spec_version: "3",
    entry: "m",
    nodes: {
      m: {
        kind: "map",
        name: "M",
        skills: [],
        items: [{ id: "a" }, { id: "b" }],
        key: "id",
        workflow: CHILD as never,
        result: "draft",
        concurrency: 1,
        ...map,
      } as Node,
    },
    edges: [],
  };
}

const agent = (fail: string[] = []): Claude => ({
  async run(req) {
    const key = (req.context as { input: { item_key: string } }).input.item_key;
    return fail.includes(key)
      ? { status: "failed", data: { error: "no" }, toolCalls: [] }
      : { status: "success", data: { k: key }, toolCalls: [] };
  },
  async evaluate() {
    throw new Error("no routing");
  },
  async ask() {
    throw new Error("no completions");
  },
});

const MAP_TYPES = new Set(["node:enter", "node:exit", "map:start", "child:start", "child:end", "map:end"]);
const strip = (e: ExecutionEvent) => {
  const { result: _r, instruction: _i, ...rest } = e as unknown as Record<string, unknown>;
  return rest;
};

describe("map events", () => {
  it("are version 2", () => {
    expect(EVENTS_VERSION).toBe(2);
  });

  it("frame the visit on the parent's observer, in order, with each child's run and generation", async () => {
    const events: ExecutionEvent[] = [];
    await execute(
      workflow(),
      {},
      {
        skills: new Map(),
        claude: agent(),
        logger: silent,
        children: createMemoryChildHost({ runId: "parent" }),
        observer: (e) => events.push(e),
      },
    );
    expect(events.filter((e) => MAP_TYPES.has(e.type)).map(strip)).toEqual([
      { type: "node:enter", node: "m" },
      { type: "map:start", node: "m", iteration: 1, keys: ["a", "b"], concurrency: 1, events_version: 2 },
      {
        type: "child:start",
        node: "m",
        key: "a",
        index: 0,
        run: "parent/m#1/a@g1",
        parent_run: "parent",
        generation: 1,
        action: "launch",
        events_version: 2,
      },
      {
        type: "child:end",
        node: "m",
        key: "a",
        status: "success",
        parent_run: "parent",
        run: "parent/m#1/a@g1",
        generation: 1,
        events_version: 2,
      },
      {
        type: "child:start",
        node: "m",
        key: "b",
        index: 1,
        run: "parent/m#1/b@g1",
        parent_run: "parent",
        generation: 1,
        action: "launch",
        events_version: 2,
      },
      {
        type: "child:end",
        node: "m",
        key: "b",
        status: "success",
        parent_run: "parent",
        run: "parent/m#1/b@g1",
        generation: 1,
        events_version: 2,
      },
      {
        type: "map:end",
        node: "m",
        status: "success",
        counts: { total: 2, success: 2, failed: 0, skipped: 0, cancelled: 0 },
        events_version: 2,
      },
      { type: "node:exit", node: "m" },
    ]);
    // The parent's own events keep their shape: no run scope.
    expect(events.some((e) => e.type === "node:enter" && "run" in e)).toBe(false);
  });

  it("an item no generation was opened for ends without a run", async () => {
    const events: ExecutionEvent[] = [];
    await execute(
      workflow(),
      {},
      {
        skills: new Map(),
        claude: agent(["a"]),
        logger: silent,
        children: createMemoryChildHost({ runId: "parent" }),
        observer: (e) => events.push(e),
      },
    );
    expect(events.filter((e) => e.type === "child:end").map(strip)).toEqual([
      {
        type: "child:end",
        node: "m",
        key: "a",
        status: "failed",
        parent_run: "parent",
        run: "parent/m#1/a@g1",
        generation: 1,
        error: 'node "draft" failed: no',
        events_version: 2,
      },
      {
        type: "child:end",
        node: "m",
        key: "b",
        status: "cancelled",
        parent_run: "parent",
        error: "not started: the map was stopping",
        events_version: 2,
      },
    ]);
    const end = events.find((e) => e.type === "map:end");
    expect(end && end.type === "map:end" && [end.status, end.counts.cancelled]).toEqual(["failed", 1]);
  });

  it("scopes each child's own events to its run, parent run and generation", async () => {
    const childEvents: ExecutionEvent[] = [];
    await execute(
      workflow({ items: [{ id: "a" }] }),
      {},
      {
        skills: new Map(),
        claude: agent(),
        logger: silent,
        children: createMemoryChildHost({ runId: "parent", observer: () => (e) => childEvents.push(e) }),
      },
    );
    expect(childEvents.map((e) => e.type)).toEqual([
      "workflow:start",
      "sources:resolved",
      "node:enter",
      "node:exit",
      "workflow:end",
    ]);
    for (const e of childEvents) {
      expect([e.run, e.parent_run, e.generation, e.events_version]).toEqual(["parent/m#1/a@g1", "parent", 1, 2]);
    }
  });

  it("a map that fails before any spend sends no map events", async () => {
    const events: ExecutionEvent[] = [];
    await execute(
      workflow({ items: undefined, over: "input.todos" }),
      {},
      {
        skills: new Map(),
        claude: agent(),
        logger: silent,
        children: createMemoryChildHost(),
        observer: (e) => events.push(e),
      },
    );
    expect(events.filter((e) => e.type.startsWith("map:") || e.type.startsWith("child:"))).toEqual([]);
  });
});
