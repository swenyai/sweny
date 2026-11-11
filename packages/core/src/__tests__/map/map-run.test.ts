/**
 * Map visits (#575, RFC 0002 M1, milestone 3): the p-limit pool, fail-fast and
 * collect, cancellation, item derivation and the results. Fake agents only.
 */
import { describe, it, expect } from "vitest";

import { execute } from "../../executor.js";
import { itemOutcome, mapResult, prepareMap, type ChildRunHost } from "../../map.js";
import { createMemoryChildHost } from "../../child-host.js";
import { withMapOutputs } from "../../map-spec.js";
import type { Claude, ExecutionResult, Node, NodeResult, Workflow } from "../../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

type Req = Parameters<Claude["run"]>[0];
type Behave = (input: { item: unknown; item_key: string; [k: string]: unknown }, req: Req) => Promise<NodeResult>;

/** A fake agent: child runs get their input from req.context.input; parent agent nodes answer by node id. */
function fakeClaude(child: Behave, parent: Record<string, Record<string, unknown>> = {}) {
  const calls: Req[] = [];
  let running = 0;
  let maxRunning = 0;
  const claude: Claude = {
    async run(req) {
      calls.push(req);
      if (req.nodeId && parent[req.nodeId]) return { status: "success", data: parent[req.nodeId], toolCalls: [] };
      running++;
      maxRunning = Math.max(maxRunning, running);
      try {
        return await child((req.context as { input: never }).input, req);
      } finally {
        running--;
      }
    },
    async evaluate() {
      throw new Error("no routing in these tests");
    },
    async ask() {
      throw new Error("no completions in these tests");
    },
  };
  return { claude, calls, maxRunning: () => maxRunning };
}

const ok = (prompt: string): NodeResult => ({ status: "success", data: { prompt }, toolCalls: [] });
const hangUntilAborted = (req: Req) =>
  new Promise<NodeResult>((_, reject) => {
    if (req.signal?.aborted) return reject(new Error("aborted"));
    req.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

const CHILD = {
  entry: "draft",
  nodes: {
    draft: {
      name: "Draft",
      instruction: "Draft a prompt for the item.",
      skills: [],
      output: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
    },
  },
  edges: [],
};

function workflow(map: Partial<Node>, extra: Partial<Workflow> = {}): Workflow {
  return {
    id: "p",
    name: "P",
    description: "",
    spec_version: "3",
    entry: "m",
    nodes: {
      m: {
        kind: "map",
        name: "Map",
        skills: [],
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        key: "id",
        workflow: CHILD as never,
        result: "draft",
        ...map,
      } as Node,
    },
    edges: [],
    ...extra,
  };
}

/** A memory host that records what the map asked of it. */
function recordingHost(): { host: ChildRunHost; log: string[] } {
  const log: string[] = [];
  const base = createMemoryChildHost({ runId: "parent" });
  const host: ChildRunHost = {
    runId: "parent",
    open: async (ref, opts) => {
      log.push(`open ${ref.key}`);
      const run = await base.open(ref, opts);
      return {
        ...run,
        end: (s) => log.push(`end ${ref.key} ${s}`),
        detach: () => log.push(`detach ${ref.key}`),
        crashed: () => log.push(`crashed ${ref.key}`),
      };
    },
  };
  return { host, log };
}

const run = (wf: Workflow, claude: Claude, host: ChildRunHost, input: unknown = {}, signal?: AbortSignal) =>
  execute(wf, input, { skills: new Map(), claude, logger: silent, children: host, ...(signal ? { signal } : {}) });

const mapData = (res: ExecutionResult) => res.results.get("m")!.data as Record<string, unknown>;

describe("a map visit", () => {
  it("returns items by key, order and results in input order, whatever finishes first", async () => {
    const delays: Record<string, number> = { a: 30, b: 10, c: 0 };
    const { claude } = fakeClaude(async (input) => {
      await tick(delays[input.item_key]);
      return ok(`p-${input.item_key}`);
    });
    const { host, log } = recordingHost();
    const res = await run(workflow({}), claude, host);
    const m = res.results.get("m")!;
    expect(m.status).toBe("success");
    expect(m.data).toEqual({
      items: {
        a: { status: "success", data: { prompt: "p-a" } },
        b: { status: "success", data: { prompt: "p-b" } },
        c: { status: "success", data: { prompt: "p-c" } },
      },
      order: ["a", "b", "c"],
      results: [{ prompt: "p-a" }, { prompt: "p-b" }, { prompt: "p-c" }],
      counts: { total: 3, success: 3, failed: 0, skipped: 0, cancelled: 0 },
    });
    expect(log.filter((l) => l.startsWith("end")).sort()).toEqual(["end a success", "end b success", "end c success"]);
    expect(res.trace.steps).toEqual([{ node: "m", status: "success", iteration: 1 }]);
  });

  it("gives a child exactly its item, its key and the with values: no parent results, read-only", async () => {
    const { claude, calls } = fakeClaude(async (input) => ok(input.item_key), {
      list: { items: [{ id: "x" }], team: "T" },
    });
    const res = await run(
      {
        ...workflow({}),
        entry: "list",
        nodes: {
          list: {
            name: "List",
            instruction: "List.",
            skills: [],
            output: { type: "object", properties: { items: { type: "array" }, team: { type: "string" } } },
          },
          m: workflow({ items: undefined, over: "list.items", with: { team: "list.team", who: "input.who" } }).nodes.m,
        },
        edges: [{ from: "list", to: "m" }],
      },
      claude,
      recordingHost().host,
      { who: "me", secret: "parent-only" },
    );
    expect(res.results.get("m")!.status).toBe("success");
    const childCall = calls.find((c) => c.nodeId === "draft")!;
    expect(childCall.context).toEqual({ input: { item: { id: "x" }, item_key: "x", team: "T", who: "me" } });
    expect(childCall.readOnly).toBe(true);
  });

  it.each([
    [2, 6, 2],
    [undefined, 6, 4],
    [16, 3, 3],
  ])("runs at most concurrency %s children at once (%i items -> %i)", async (concurrency, n, expected) => {
    const { claude, maxRunning } = fakeClaude(async (input) => {
      await tick(5);
      return ok(input.item_key);
    });
    const items = Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));
    const res = await run(workflow({ items, ...(concurrency ? { concurrency } : {}) }), claude, recordingHost().host);
    expect(res.results.get("m")!.status).toBe("success");
    expect(maxRunning()).toBe(expected);
  });
});

describe("fail-fast (the default)", () => {
  it("launches nothing after the first failure: queued items are cancelled without a generation", async () => {
    const { claude } = fakeClaude(async (input) =>
      input.item_key === "a" ? { status: "failed", data: { error: "boom" }, toolCalls: [] } : ok(input.item_key),
    );
    const { host, log } = recordingHost();
    const res = await run(workflow({ concurrency: 1 }), claude, host);
    expect(log).toEqual(["open a", "end a failed"]);
    const m = res.results.get("m")!;
    expect(m.status).toBe("failed");
    expect(m.data).toEqual({
      items: {
        a: { status: "failed", error: 'node "draft" failed: boom' },
        b: { status: "cancelled", error: "not started: the map was stopping" },
        c: { status: "cancelled", error: "not started: the map was stopping" },
      },
      order: ["a", "b", "c"],
      results: [null, null, null],
      counts: { total: 3, success: 0, failed: 1, skipped: 0, cancelled: 2 },
      error: 'map node "m" item "a" failed: node "draft" failed: boom',
    });
  });

  it("aborts running children, which are detached (no run:end), and halts the run", async () => {
    const { claude } = fakeClaude(async (input, req) => {
      if (input.item_key === "b") {
        await tick(10);
        return { status: "failed", data: { error: "bad item" }, toolCalls: [] };
      }
      return hangUntilAborted(req);
    });
    const { host, log } = recordingHost();
    const wf = workflow(
      {},
      { nodes: { ...workflow({}).nodes, after: { name: "After", instruction: "x", skills: [] } } },
    );
    wf.edges = [{ from: "m", to: "after" }];
    const res = await run(wf, claude, host);
    expect([...log].sort()).toEqual(["detach a", "detach c", "end b failed", "open a", "open b", "open c"]);
    expect(mapData(res).counts).toEqual({ total: 3, success: 0, failed: 1, skipped: 0, cancelled: 2 });
    expect((mapData(res).items as Record<string, unknown>).a).toEqual({
      status: "cancelled",
      error: "cancelled while running",
    });
    expect(res.results.has("after")).toBe(false);
  });

  it("a child that finished with success keeps it, even when the stop fired before the map looked", async () => {
    let failed: () => void = () => {};
    const aFailed = new Promise<void>((resolve) => (failed = resolve));
    const { claude } = fakeClaude(async (input) => {
      if (input.item_key === "a") {
        failed();
        return { status: "failed", data: { error: "bad" }, toolCalls: [] };
      }
      // b's work is done; it returns only after a's failure has aborted the map.
      await aFailed;
      await tick(20);
      return ok("b");
    });
    const { host, log } = recordingHost();
    const res = await run(workflow({ items: [{ id: "a" }, { id: "b" }], concurrency: 2 }), claude, host);
    expect([...log].sort()).toEqual(["end a failed", "end b success", "open a", "open b"]);
    expect(mapData(res).items).toEqual({
      a: { status: "failed", error: 'node "draft" failed: bad' },
      b: { status: "success", data: { prompt: "b" } },
    });
    expect(mapData(res).counts).toEqual({ total: 2, success: 1, failed: 1, skipped: 0, cancelled: 0 });
  });

  it("on_fail: continue routes on from a failed map", async () => {
    const { claude } = fakeClaude(async () => ({ status: "failed", data: {}, toolCalls: [] }), { after: { ok: true } });
    const wf = workflow(
      { on_fail: "continue" },
      { nodes: { ...workflow({}).nodes, after: { name: "After", instruction: "x", skills: [] } } },
    );
    wf.nodes.m = { ...wf.nodes.m, on_fail: "continue" };
    wf.edges = [{ from: "m", to: "after" }];
    const res = await run(wf, claude, recordingHost().host);
    expect(res.results.get("m")!.status).toBe("failed");
    expect(res.results.get("after")!.status).toBe("success");
  });
});

describe("collect", () => {
  const someFail = () =>
    fakeClaude(async (input) =>
      input.item_key === "b" ? { status: "failed", data: { error: "no" }, toolCalls: [] } : ok(input.item_key),
    );

  it("runs every item; min_success all fails the map on one failure", async () => {
    const { host, log } = recordingHost();
    const res = await run(workflow({ on_item_fail: "collect" }), someFail().claude, host);
    expect(log.filter((l) => l.startsWith("open")).sort()).toEqual(["open a", "open b", "open c"]);
    expect(res.results.get("m")!.status).toBe("failed");
    expect(mapData(res).counts).toEqual({ total: 3, success: 2, failed: 1, skipped: 0, cancelled: 0 });
    expect(mapData(res).results).toEqual([{ prompt: "a" }, null, { prompt: "c" }]);
    expect(mapData(res).error).toBe('map node "m" 2 of 3 items succeeded; the map needs 3');
  });

  it("succeeds when successes reach min_success", async () => {
    const res = await run(
      workflow({ on_item_fail: "collect", min_success: 2 }),
      someFail().claude,
      recordingHost().host,
    );
    expect(res.results.get("m")!.status).toBe("success");
    expect(mapData(res).error).toBeUndefined();
    const three = await run(
      workflow({ on_item_fail: "collect", min_success: 3 }),
      someFail().claude,
      recordingHost().host,
    );
    expect(three.results.get("m")!.status).toBe("failed");
  });
});

describe("items", () => {
  it("an empty list succeeds with empty results by default, and fails with on_empty: fail", async () => {
    const { claude, calls } = fakeClaude(async () => ok("x"));
    const { host, log } = recordingHost();
    const res = await run(workflow({ items: [] }), claude, host);
    expect(res.results.get("m")).toEqual({
      status: "success",
      data: {
        items: {},
        order: [],
        results: [],
        counts: { total: 0, success: 0, failed: 0, skipped: 0, cancelled: 0 },
      },
      toolCalls: [],
    });
    const failing = await run(workflow({ items: [], on_empty: "fail" }), claude, host);
    expect(failing.results.get("m")!.status).toBe("failed");
    expect(mapData(failing).error).toBe('map node "m" has no items (on_empty: fail)');
    expect(calls).toEqual([]);
    expect(log).toEqual([]);
  });

  it.each([
    ["a missing over", { items: undefined, over: "input.todos" }, {}, 'map node "m" over "input.todos" found nothing'],
    [
      "a non-array over",
      { items: undefined, over: "input.todos" },
      { todos: { a: 1 } },
      'map node "m" over "input.todos" is not a list (it is object)',
    ],
    [
      "duplicate keys",
      { items: undefined, over: "input.todos" },
      { todos: [{ id: "a" }, { id: "a" }] },
      'map node "m" has two items with key "a"; keys must be unique',
    ],
    [
      "too many items",
      { items: undefined, over: "input.todos", max_items: 2 },
      { todos: [1, 2, 3] },
      'map node "m" has 3 items, more than max_items (2)',
    ],
    [
      "a bad key",
      { items: undefined, over: "input.todos" },
      { todos: [{ id: "a b" }] },
      'map node "m" item 0 key "a b" must match ^[A-Za-z0-9_-]{1,64}$',
    ],
    ["a missing with value", { with: { team: "input.team" } }, {}, 'map node "m" with.team "input.team" found nothing'],
  ])("%s fails the map before any spend", async (_label, patch, input, error) => {
    const { claude, calls } = fakeClaude(async () => ok("x"));
    const { host, log } = recordingHost();
    const res = await run(workflow(patch as Partial<Node>), claude, host, input);
    expect(res.results.get("m")).toEqual({ status: "failed", data: { error }, toolCalls: [] });
    expect(calls).toEqual([]);
    expect(log).toEqual([]);
  });

  it("keys by $index", async () => {
    const { claude } = fakeClaude(async (input) => ok(String(input.item)));
    const res = await run(workflow({ items: ["x", "y"], key: "$index" }), claude, recordingHost().host);
    expect(mapData(res).order).toEqual(["0", "1"]);
    expect(mapData(res).results).toEqual([{ prompt: "x" }, { prompt: "y" }]);
  });

  it("prepares items from input or a node, and hashes them for registration", () => {
    const wf = workflow({ items: undefined, over: "input.todos" });
    const child = { ...wf, ...CHILD } as unknown as Workflow;
    const a = prepareMap(wf.nodes.m, child, { todos: [{ id: "a" }] }, new Map());
    const b = prepareMap(wf.nodes.m, child, { todos: [{ id: "a" }] }, new Map());
    const c = prepareMap(wf.nodes.m, child, { todos: [{ id: "b" }] }, new Map());
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(a.registration).toEqual(b.registration);
    expect(a.registration.keys).toEqual(["a"]);
    expect(a.registration.items_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.registration.items_hash).not.toBe(c.registration.items_hash);
    expect(a.registration.workflow_hash).toBe(c.registration.workflow_hash);
    const fromNode = prepareMap(
      { ...wf.nodes.m, over: "list.out.todos" },
      child,
      {},
      new Map([["list", { status: "success", data: { out: { todos: [{ id: "z" }] } }, toolCalls: [] }]]),
    );
    expect(fromNode.ok && fromNode.keys).toEqual(["z"]);
  });
});

describe("item outcomes", () => {
  const child = { nodes: CHILD.nodes } as unknown as Workflow;
  const res = (entries: Array<[string, NodeResult]>): ExecutionResult => ({
    results: new Map(entries),
    trace: { steps: [], edges: [], sources: {} },
  });

  it("checks the result against its declared schema, failing on any problem", () => {
    expect(
      itemOutcome(res([["draft", { status: "success", data: { prompt: 1 }, toolCalls: [] }]]), child, "draft"),
    ).toEqual({
      status: "failed",
      error: "result: output schema violation: prompt: expected string",
    });
    expect(itemOutcome(res([["draft", { status: "success", data: {}, toolCalls: [] }]]), child, "draft")).toEqual({
      status: "failed",
      error: "result: output schema violation: required field(s) missing from emitted data: prompt",
    });
  });

  it("reads a skipped result node as a skipped item, and a missing one as a failure", () => {
    expect(
      itemOutcome(
        res([["draft", { status: "skipped", data: { skipped_reason: "requires not met: x" }, toolCalls: [] }]]),
        child,
        "draft",
      ),
    ).toEqual({ status: "skipped", error: "requires not met: x" });
    expect(itemOutcome(res([]), child, "draft")).toEqual({
      status: "failed",
      error: 'the child ended without running its result node "draft"',
    });
    expect(itemOutcome(res([["other", { status: "failed", data: {}, toolCalls: [] }]]), child, "draft")).toEqual({
      status: "failed",
      error: 'node "other" failed',
    });
  });

  it("counts a skipped item as finished under fail-fast, not as a success under collect", () => {
    const prepared = {
      ok: true as const,
      items: [1, 2],
      keys: ["a", "b"],
      withValues: {},
      registration: { items_hash: "h", keys: ["a", "b"], workflow_hash: "w" },
    };
    const outcomes = [{ status: "success" as const, data: { prompt: "p" } }, { status: "skipped" as const }];
    const ff = mapResult({ nodeId: "m", node: { name: "M", instruction: "", skills: [] }, prepared }, outcomes);
    expect(ff.status).toBe("success");
    const col = mapResult(
      { nodeId: "m", node: { name: "M", instruction: "", skills: [], on_item_fail: "collect" }, prepared },
      outcomes,
    );
    expect([col.status, (col.data as { error?: string }).error]).toEqual([
      "failed",
      'map node "m" 1 of 2 items succeeded; the map needs 2',
    ]);
  });
});

describe("the run around a map", () => {
  it("needs a child-run host", async () => {
    const { claude } = fakeClaude(async () => ok("x"));
    await expect(execute(workflow({}), {}, { skills: new Map(), claude, logger: silent })).rejects.toThrow(
      'Map node "m" needs a child-run host (ExecuteOptions.children): createJournalChildHost or createMemoryChildHost',
    );
  });

  it("an aborted run rejects, and its running children are detached", async () => {
    const ctl = new AbortController();
    const { claude } = fakeClaude(async (_input, req) => {
      setTimeout(() => ctl.abort(), 5);
      return hangUntilAborted(req);
    });
    const { host, log } = recordingHost();
    await expect(run(workflow({ concurrency: 1 }), claude, host, {}, ctl.signal)).rejects.toThrow("workflow aborted");
    expect(log).toEqual(["open a", "detach a"]);
  });

  it("a crashed child (not a cancel) fails its item and is released for resume", async () => {
    const { claude } = fakeClaude(async () => {
      throw new Error("harness exploded");
    });
    const { host, log } = recordingHost();
    const res = await run(workflow({ items: [{ id: "a" }] }), claude, host);
    expect(log).toEqual(["open a", "crashed a"]);
    expect(mapData(res).items).toEqual({ a: { status: "failed", error: "harness exploded" } });
  });

  it("a host that cannot open a child fails that item", async () => {
    const { claude } = fakeClaude(async () => ok("x"));
    const host: ChildRunHost = {
      runId: "p",
      open: async () => {
        throw new Error("slot locked");
      },
    };
    const res = await run(workflow({ items: [{ id: "a" }] }), claude, host);
    expect(mapData(res).items).toEqual({ a: { status: "failed", error: "could not open its child run: slot locked" } });
  });

  it("a downstream node sees the map's declared output, and an expression routes on its counts", async () => {
    const { claude, calls } = fakeClaude(async (input) => ok(input.item_key), { store: { stored: true } });
    const base = workflow({});
    const wf: Workflow = {
      ...base,
      nodes: {
        ...base.nodes,
        store: { name: "Store", instruction: "Store the prompts.", skills: [] },
        alarm: { name: "Alarm", instruction: "x", skills: [] },
      },
      edges: [
        { from: "m", to: "store", when: { expr: "m.counts.failed == 0" } },
        { from: "m", to: "alarm", when: { expr: "m.counts.failed > 0" } },
      ],
    };
    const res = await run(wf, claude, recordingHost().host);
    expect(res.results.get("store")!.status).toBe("success");
    expect(res.results.has("alarm")).toBe(false);
    const store = calls.find((c) => c.nodeId === "store")!;
    expect(Object.keys((store.context as Record<string, Record<string, unknown>>).m).sort()).toEqual(
      ["counts", "evals", "items", "order", "results"].sort(),
    );
    expect(withMapOutputs(wf).nodes.m.output).toBeDefined();
  });
});
