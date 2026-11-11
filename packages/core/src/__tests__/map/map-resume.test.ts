/**
 * Crash and resume at every map boundary (#575, RFC 0002 M1, milestone 5):
 * the parent stopping mid-launch, a child crashing, a child failing, a
 * finished map replaying, and a changed item list on resume. Real journals
 * in a scratch state dir; fake agents.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { execute } from "../../executor.js";
import {
  JournalMismatchError,
  RunJournal,
  buildResumePlan,
  journalFile,
  lockRun,
  readJournal,
  type ChildRegistration,
  type ExecutionJournal,
} from "../../journal.js";
import { createJournalChildHost, createMemoryChildHost } from "../../child-host.js";
import type { ChildRunHost } from "../../map.js";
import type { Claude, Node, NodeResult, Workflow } from "../../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
const RUN = "20261111-090000-abcdef";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function space() {
  const cwd = mkdtempSync(join(tmpdir(), "sweny-map-resume-ws-"));
  const state = mkdtempSync(join(tmpdir(), "sweny-map-resume-state-"));
  dirs.push(cwd, state);
  return { cwd, stateRoot: join(state, "runs") };
}

const CHILD = {
  entry: "draft",
  nodes: {
    draft: {
      name: "Draft",
      instruction: "Draft.",
      skills: [],
      output: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
    },
  },
  edges: [],
};

function workflow(map: Partial<Node> = {}, extra: Partial<Workflow> = {}): Workflow {
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
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        key: "id",
        workflow: CHILD as never,
        result: "draft",
        concurrency: 1,
        ...map,
      } as Node,
    },
    edges: [],
    ...extra,
  };
}

type Act = "ok" | "fail" | "throw" | "hang";
/** A fake agent: per item key, what each successive call does (the last one repeats). */
function agent(plan: Record<string, Act[]>, onCall?: (key: string) => void) {
  const calls: string[] = [];
  const claude: Claude = {
    async run(req) {
      const key = (req.context as { input: { item_key: string } }).input.item_key;
      const n = calls.filter((c) => c === key).length;
      calls.push(key);
      onCall?.(key);
      const acts = plan[key] ?? ["ok"];
      const act = acts[Math.min(n, acts.length - 1)];
      if (act === "throw") throw new Error("harness exploded");
      if (act === "hang") {
        await new Promise<void>((resolve) => req.signal?.addEventListener("abort", () => resolve(), { once: true }));
        throw new Error("aborted");
      }
      if (act === "fail") return { status: "failed", data: { error: "bad" }, toolCalls: [] };
      await tick(1);
      return { status: "success", data: { prompt: `p-${key}` }, toolCalls: [], usage: { inputTokens: 10 } };
    },
    async evaluate() {
      throw new Error("no routing");
    },
    async ask() {
      throw new Error("no completions");
    },
  };
  return { claude, calls };
}

interface Sp {
  cwd: string;
  stateRoot: string;
}

/** A first run, with a fresh parent journal and a journal child host; returns what `sweny workflow run` would. */
async function firstRun(
  sp: Sp,
  wf: Workflow,
  claude: Claude,
  signal?: AbortSignal,
  opts: { version?: string; input?: Record<string, unknown> } = {},
) {
  const version = opts.version ?? "9.9.9";
  const journal = RunJournal.create({ runId: RUN, cwd: sp.cwd, stateRoot: sp.stateRoot, swenyVersion: version });
  const host = createJournalChildHost({
    parentRunId: RUN,
    cwd: sp.cwd,
    stateRoot: sp.stateRoot,
    swenyVersion: version,
  });
  try {
    const res = await execute(wf, opts.input ?? {}, {
      skills: new Map(),
      claude,
      logger: silent,
      journal,
      children: host,
      ...(signal ? { signal } : {}),
    });
    journal.end([...res.results.values()].some((r) => r.status === "failed") ? "failed" : "success");
    return res;
  } catch (err) {
    journal.end("crashed");
    throw err;
  }
}

/** `sweny workflow resume`: lock, read, plan, reopen the parent journal; the host finds the children. */
async function resume(
  sp: Sp,
  wf: Workflow,
  claude: Claude,
  opts: { force?: boolean; host?: ChildRunHost; version?: string; input?: Record<string, unknown> } = {},
) {
  const version = opts.version ?? "9.9.9";
  const lock = lockRun(sp.cwd, RUN, sp.stateRoot);
  const read = readJournal(journalFile(sp.cwd, RUN, sp.stateRoot), { repair: true });
  const journal = RunJournal.openForResume({
    runId: RUN,
    cwd: sp.cwd,
    stateRoot: sp.stateRoot,
    swenyVersion: version,
    read,
    plan: buildResumePlan(read.records),
    lock,
    force: opts.force === true,
  });
  const generations: Record<string, string> = {};
  const base = createJournalChildHost({
    parentRunId: RUN,
    cwd: sp.cwd,
    stateRoot: sp.stateRoot,
    swenyVersion: version,
  });
  const host: ChildRunHost = opts.host ?? {
    ...base,
    open: async (ref, o) => {
      const run = await base.open(ref, o);
      generations[ref.key] = `g${run.generation} ${run.action}`;
      return run;
    },
  };
  try {
    const res = await execute(wf, opts.input ?? {}, {
      skills: new Map(),
      claude,
      logger: silent,
      journal,
      children: host,
    });
    journal.end([...res.results.values()].some((r) => r.status === "failed") ? "failed" : "success");
    return { res, generations };
  } catch (err) {
    journal.end("crashed");
    throw err;
  }
}

const statusOf = (res: { results: Map<string, NodeResult> }) => res.results.get("m")!.status;
const items = (res: { results: Map<string, NodeResult> }) =>
  (res.results.get("m")!.data as { items: Record<string, { status: string }> }).items;

describe("resuming a map", () => {
  it("parent stopped mid-launch: the finished child replays, running ones resume in place, the rest launch", async () => {
    const sp = space();
    const wf = workflow({ concurrency: 2, items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] });
    const ctl = new AbortController();
    // a finishes and c takes its place; b and c are running when the run stops; d never launched.
    const first = agent({ a: ["ok"], b: ["hang"], c: ["hang"] }, (key) => {
      if (key === "c") setTimeout(() => ctl.abort(), 10);
    });
    await expect(firstRun(sp, wf, first.claude, ctl.signal)).rejects.toThrow("workflow aborted");
    expect([...first.calls].sort()).toEqual(["a", "b", "c"]);

    const second = agent({});
    const { res, generations } = await resume(sp, wf, second.claude);
    expect(statusOf(res)).toBe("success");
    expect(generations).toEqual({ a: "g1 replay", b: "g1 resume", c: "g1 resume", d: "g1 launch" });
    // The finished child replayed from its journal: no model call for a.
    expect([...second.calls].sort()).toEqual(["b", "c", "d"]);
    expect((res.results.get("m")!.data as { order: string[] }).order).toEqual(["a", "b", "c", "d"]);
  });

  it("a crashed child resumes in place in the same generation", async () => {
    const sp = space();
    const wf = workflow();
    const first = agent({ a: ["throw", "ok"] });
    const r1 = await firstRun(sp, wf, first.claude);
    expect(statusOf(r1)).toBe("failed");
    expect(items(r1).a).toEqual({ status: "failed", error: "harness exploded" });
    const { res, generations } = await resume(sp, wf, first.claude);
    expect(statusOf(res)).toBe("success");
    expect(generations).toEqual({ a: "g1 resume", b: "g1 launch", c: "g1 launch" });
  });

  it("a failed child gets a new generation; the failed one is kept", async () => {
    const sp = space();
    const wf = workflow();
    const first = agent({ b: ["fail", "ok"] });
    const r1 = await firstRun(sp, wf, first.claude);
    expect(statusOf(r1)).toBe("failed");
    const { res, generations } = await resume(sp, wf, first.claude);
    expect(statusOf(res)).toBe("success");
    expect(generations).toEqual({ a: "g1 replay", b: "g2 retry", c: "g1 launch" });
    expect(first.calls).toEqual(["a", "b", "b", "c"]);
  });

  it("a finished map replays with no child opened, and its children's spend still counts", async () => {
    const sp = space();
    // 3 children x 10 tokens = 30 against a 35 cap; the next node's 10 tokens cross it only if the 30 counts.
    const wf = workflow({}, { budget: { tokens: 35 } });
    wf.nodes.after = { name: "After", instruction: "Do after.", skills: [] };
    wf.edges = [{ from: "m", to: "after" }];
    let afterCalls = 0;
    const base = agent({});
    const claude: Claude = {
      ...base.claude,
      async run(req) {
        if (req.nodeId === "after") {
          afterCalls++;
          if (afterCalls === 1) throw new Error("crash after the map");
          return { status: "success", data: {}, toolCalls: [], usage: { inputTokens: 10 } };
        }
        return base.claude.run(req);
      },
    };
    await expect(firstRun(sp, wf, claude)).rejects.toThrow("crash after the map");
    const opened: string[] = [];
    const real = createJournalChildHost({
      parentRunId: RUN,
      cwd: sp.cwd,
      stateRoot: sp.stateRoot,
      swenyVersion: "9.9.9",
    });
    const host: ChildRunHost = {
      ...real,
      open: async (ref, o) => {
        opened.push(ref.key);
        return real.open(ref, o);
      },
    };
    const { res } = await resume(sp, wf, claude, { host });
    expect(opened).toEqual([]);
    expect(base.calls).toEqual(["a", "b", "c"]);
    expect(statusOf(res)).toBe("success");
    expect(res.results.get("after")!.budget).toEqual({ scope: "run", unit: "tokens", limit: 35, spent: 40 });
  });
});

describe("a changed item list on resume", () => {
  const REG: ChildRegistration = { items_hash: "0".repeat(64), keys: ["a"], workflow_hash: "1".repeat(64) };
  /** A journal resuming a map visit whose registration differs from today's items. */
  function resumingJournal(forced: boolean): ExecutionJournal & { starts: unknown[] } {
    const starts: unknown[] = [];
    return {
      starts,
      begin() {},
      replay: () => undefined,
      nodeStart: (_n, _i, children) => void starts.push(children),
      checkpoint() {},
      wrapWrites: (_n, _i, skills) => skills,
      nodeEnd() {},
      route() {},
      registration: () => REG,
      forced: () => forced,
    };
  }

  it("is refused unless forced, before anything is journaled or launched", async () => {
    const j = resumingJournal(false);
    const { claude, calls } = agent({});
    await expect(
      execute(
        workflow(),
        {},
        { skills: new Map(), claude, logger: silent, journal: j, children: createMemoryChildHost() },
      ),
    ).rejects.toThrow(new JournalMismatchError(['the items of map node "m"']));
    expect(j.starts).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("forced, opens every slot fresh (a new generation where one exists) and registers the new items", async () => {
    const j = resumingJournal(true);
    const fresh: boolean[] = [];
    const mem = createMemoryChildHost();
    const host: ChildRunHost = {
      ...mem,
      open: async (ref, o) => {
        fresh.push(o.fresh);
        return mem.open(ref, o);
      },
    };
    const res = await execute(
      workflow(),
      {},
      { skills: new Map(), claude: agent({}).claude, logger: silent, journal: j, children: host },
    );
    expect(statusOf(res)).toBe("success");
    expect(fresh).toEqual([true, true, true]);
    expect((j.starts[0] as ChildRegistration).keys).toEqual(["a", "b", "c"]);
  });
});

describe("resuming a map after something it depends on changed", () => {
  /** A first run stopped while b and c run: a finished, d never launched. */
  async function stoppedMidMap(sp: Sp, wf: Workflow, opts: { version?: string; input?: Record<string, unknown> } = {}) {
    const ctl = new AbortController();
    const first = agent({ a: ["ok"], b: ["hang"], c: ["hang"] }, (key) => {
      if (key === "c") setTimeout(() => ctl.abort(), 10);
    });
    await expect(firstRun(sp, wf, first.claude, ctl.signal, opts)).rejects.toThrow("workflow aborted");
  }
  const four = { concurrency: 2, items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] };

  it("after a sweny upgrade, resume --force replays and resumes the children under the new version", async () => {
    const sp = space();
    const wf = workflow(four);
    await stoppedMidMap(sp, wf);
    // Without --force the run itself refuses: its tools hash names the sweny version.
    await expect(resume(sp, wf, agent({}).claude, { version: "9.9.10" })).rejects.toThrow(
      "cannot resume: the configured skills, agent or sweny version changed since this run was journaled",
    );
    const second = agent({});
    const { res, generations } = await resume(sp, wf, second.claude, { version: "9.9.10", force: true });
    expect(statusOf(res)).toBe("success");
    expect(generations).toEqual({ a: "g1 replay", b: "g1 resume", c: "g1 resume", d: "g1 launch" });
    expect([...second.calls].sort()).toEqual(["b", "c", "d"]);
  });

  it("after a with: value changed, resume --force resumes the children with their new input", async () => {
    const sp = space();
    const wf = workflow({ ...four, with: { team: "input.team" } });
    await stoppedMidMap(sp, wf, { input: { team: "A" } });
    const second = agent({});
    const { res, generations } = await resume(sp, wf, second.claude, { input: { team: "B" }, force: true });
    expect(statusOf(res)).toBe("success");
    expect(generations).toEqual({ a: "g1 replay", b: "g1 resume", c: "g1 resume", d: "g1 launch" });
    expect([...second.calls].sort()).toEqual(["b", "c", "d"]);
  });

  it("a child whose instructions changed refuses once, naming the child and what changed; --force completes the map", async () => {
    const sp = space();
    const instructions = join(sp.cwd, "draft.md");
    writeFileSync(instructions, "Draft a prompt.", "utf-8");
    const child = { ...CHILD, nodes: { draft: { ...CHILD.nodes.draft, instruction: { file: instructions } } } };
    const wf = workflow({ concurrency: 1, workflow: child as never });
    const ctl = new AbortController();
    const first = agent({ a: ["ok"], b: ["hang"] }, (key) => {
      if (key === "b") setTimeout(() => ctl.abort(), 10);
    });
    await expect(firstRun(sp, wf, first.claude, ctl.signal)).rejects.toThrow("workflow aborted");
    // The parent's own instructions did not change; only the child's.
    writeFileSync(instructions, "Draft a better prompt.", "utf-8");
    const refused =
      `cannot resume map node "m" item "a" (child run ${RUN}/m#1/a@g1): instructions, rules or context files ` +
      `changed since it was journaled. Resuming would mix results from two different runs. Start a new run, ` +
      `or resume with --force.`;
    const noForce = agent({});
    for (let i = 0; i < 2; i++) {
      await expect(resume(sp, wf, noForce.claude)).rejects.toThrow(
        new JournalMismatchError(
          ["instructions, rules or context files"],
          `map node "m" item "a" (child run ${RUN}/m#1/a@g1)`,
        ),
      );
    }
    expect(
      new JournalMismatchError(
        ["instructions, rules or context files"],
        `map node "m" item "a" (child run ${RUN}/m#1/a@g1)`,
      ).message,
    ).toBe(refused);
    expect(noForce.calls).toEqual([]);
    const forced = agent({});
    const { res, generations } = await resume(sp, wf, forced.claude, { force: true });
    expect(statusOf(res)).toBe("success");
    expect(generations).toEqual({ a: "g1 replay", b: "g1 resume", c: "g1 launch" });
    expect(forced.calls).toEqual(["b", "c"]);
  });
});
