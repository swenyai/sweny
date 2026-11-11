/**
 * Map children (#575, RFC 0002 M1, milestone 2): the child-run host, slots
 * and generations, and what the journal adds for them (detach, the children
 * registration on node:start, the parent field, the pre-v3 refusal).
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import {
  JOURNAL_FILE,
  JournalIntegrityError,
  RunJournal,
  buildResumePlan,
  journalDir,
  listJournalRuns,
  mayRepeatWrites,
  preV3Refusal,
  readJournal,
  type ChildRegistration,
  type JournalRecord,
  type RunStartRecord,
} from "../../journal.js";
import { createWriteStageState } from "../../safe-outputs.js";
import { createJournalChildHost, createMemoryChildHost, generationState } from "../../child-host.js";
import { childAction, childRef, generationRunId, type ChildRunRef } from "../../map.js";
import type { Skill, Workflow } from "../../types.js";

const dirs: string[] = [];
const tmp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PARENT = "20261110-120000-abcdef";
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const CHILD_WF: Workflow = {
  id: "todos.draft_all",
  name: "Draft all",
  description: "",
  spec_version: "3",
  entry: "draft",
  nodes: { draft: { name: "Draft", instruction: "Draft.", skills: [] } },
  edges: [],
};
const info = (input: unknown = { item: { id: "a" }, item_key: "a" }) => ({
  workflow: CHILD_WF,
  input,
  sources: { "nodes.draft.instruction": { content: "Draft." } },
  skills: new Map<string, Skill>(),
  config: {},
  writeState: createWriteStageState(),
});

function setup() {
  const cwd = tmp("sweny-map-ws-");
  const stateRoot = join(tmp("sweny-map-state-"), "runs");
  const host = createJournalChildHost({ parentRunId: PARENT, cwd, stateRoot, swenyVersion: "9.9.9" });
  const ref = childRef(PARENT, "draft_all", 1, "a", 0, H1, H2);
  const genDir = (n: number) => join(journalDir(cwd, PARENT, stateRoot), "children", ref.slot, `g${n}`);
  const records = (n: number): JournalRecord[] =>
    readJournal(join(genDir(n), JOURNAL_FILE), { runId: generationRunId(ref, n) }).records;
  return { cwd, stateRoot, host, ref, genDir, records };
}

describe("the child lifecycle (RFC 0002 §1.2)", () => {
  it.each([
    [undefined, false, "launch"],
    ["empty", false, "recreate"],
    ["unfinished", false, "resume"],
    ["success", false, "replay"],
    ["failed", false, "retry"],
    [undefined, true, "launch"],
    ["empty", true, "recreate"],
    ["unfinished", true, "retry"],
    ["success", true, "retry"],
    ["failed", true, "retry"],
  ] as const)("latest %s (fresh %s) -> %s", (latest, fresh, action) => {
    expect(childAction(latest, fresh)).toBe(action);
  });

  it("names a child by parent run, visit and key; its slot is the id's sha256 prefix", () => {
    const ref = childRef(PARENT, "draft_all", 2, "todo-7", 3, H1, H2);
    expect(ref).toEqual({
      parentRun: PARENT,
      node: "draft_all",
      iteration: 2,
      key: "todo-7",
      index: 3,
      logicalId: `${PARENT}/draft_all#2/todo-7`,
      slot: sha(`${PARENT}/draft_all#2/todo-7`).slice(0, 16),
      itemsHash: H1,
      workflowHash: H2,
    });
    expect(generationRunId(ref, 3)).toBe(`${PARENT}/draft_all#2/todo-7@g3`);
  });
});

describe("the journal child host", () => {
  it("launches g1 in the slot under the parent run, and its run:start names the parent", async () => {
    const { host, ref, genDir, records } = setup();
    expect(host.runId).toBe(PARENT);
    const run = await host.open(ref, { fresh: false });
    expect([run.runId, run.generation, run.action]).toEqual([`${ref.logicalId}@g1`, 1, "launch"]);
    run.journal!.begin(info());
    run.end("success");
    expect(existsSync(join(genDir(1), JOURNAL_FILE))).toBe(true);
    const [start, end] = records(1);
    expect(start.type).toBe("run:start");
    expect(start.run_id).toBe(`${ref.logicalId}@g1`);
    expect(start.spec_version).toBe("3");
    expect(start.sweny_version).toBe("9.9.9");
    expect(start.parent).toEqual({
      run: PARENT,
      node: "draft_all",
      iteration: 1,
      key: "a",
      generation: 1,
      items_hash: H1,
    });
    expect([end.type, end.status]).toEqual(["run:end", "success"]);
    expect(generationState(genDir(1), run.runId)).toBe("success");
  });

  it("replays a finished generation in place", async () => {
    const { host, ref } = setup();
    const first = await host.open(ref, { fresh: false });
    first.journal!.begin(info());
    first.end("success");
    const again = await host.open(ref, { fresh: false });
    expect([again.generation, again.action]).toEqual([1, "replay"]);
    again.detach();
  });

  it("starts generation 2 after a failed one, and keeps both", async () => {
    const { host, ref, genDir } = setup();
    const first = await host.open(ref, { fresh: false });
    first.journal!.begin(info());
    first.end("failed");
    const second = await host.open(ref, { fresh: false });
    expect([second.runId, second.generation, second.action]).toEqual([`${ref.logicalId}@g2`, 2, "retry"]);
    second.journal!.begin(info());
    second.end("success");
    expect(readdirSync(join(genDir(1), "..")).sort()).toEqual(["g1", "g2"]);
    expect(generationState(genDir(1), generationRunId(ref, 1))).toBe("failed");
  });

  it("resumes a detached (cancelled) generation in place: detach writes no run:end and frees the lock", async () => {
    const { host, ref, genDir, records } = setup();
    const first = await host.open(ref, { fresh: false });
    first.journal!.begin(info());
    first.journal!.nodeStart("draft", 1);
    first.detach();
    expect(existsSync(join(genDir(1), "lock"))).toBe(false);
    expect(records(1).map((r) => r.type)).toEqual(["run:start", "node:start"]);
    expect(generationState(genDir(1), first.runId)).toBe("unfinished");
    const again = await host.open(ref, { fresh: false });
    expect([again.generation, again.action]).toEqual([1, "resume"]);
    again.journal!.begin(info());
    again.end("success");
    expect(records(1).map((r) => r.type)).toEqual(["run:start", "node:start", "run:resume", "run:end"]);
  });

  it("a crashed child (crashed()) also resumes in place", async () => {
    const { host, ref } = setup();
    const first = await host.open(ref, { fresh: false });
    first.journal!.begin(info());
    first.crashed();
    const again = await host.open(ref, { fresh: false });
    expect([again.generation, again.action]).toEqual([1, "resume"]);
    again.detach();
  });

  it("recreates an init-only generation (head at seq 0, nothing spent) under the slot lock", async () => {
    const { host, ref, genDir, cwd } = setup();
    const runId = generationRunId(ref, 1);
    // The process dies after the key and head were written, before run:start.
    const crash = RunJournal.create({
      runId,
      cwd,
      dir: genDir(1),
      prune: false,
      faults: {
        beforeAppend: () => {
          throw new Error("killed");
        },
      },
    });
    expect(() => crash.begin(info())).toThrow("killed");
    expect(existsSync(join(genDir(1), "key"))).toBe(true);
    expect(existsSync(join(genDir(1), JOURNAL_FILE))).toBe(false);
    expect(generationState(genDir(1), runId)).toBe("empty");
    const again = await host.open(ref, { fresh: false });
    expect([again.generation, again.action]).toEqual([1, "recreate"]);
    again.journal!.begin(info());
    again.end("success");
    expect(generationState(genDir(1), runId)).toBe("success");
  });

  it("a fresh (forced, items changed) open starts a new generation over a finished one", async () => {
    const { host, ref } = setup();
    const first = await host.open(ref, { fresh: false });
    first.journal!.begin(info());
    first.end("success");
    const fresh = await host.open(ref, { fresh: true });
    expect([fresh.generation, fresh.action]).toEqual([2, "retry"]);
    fresh.detach();
  });

  it("sums every generation's journaled spend for the tally", async () => {
    const { host, ref } = setup();
    const other: ChildRunRef = childRef(PARENT, "draft_all", 1, "b", 1, H1, H2);
    const g1 = await host.open(ref, { fresh: false });
    g1.journal!.begin(info());
    g1.journal!.nodeStart("draft", 1);
    g1.journal!.usage!("draft", 1, 0, { inputTokens: 30, outputTokens: 10, costUsd: 0.25 }, true);
    g1.end("failed");
    const g2 = await host.open(ref, { fresh: false });
    g2.journal!.begin(info());
    g2.journal!.nodeStart("draft", 1);
    g2.journal!.usage!("draft", 1, 0, { inputTokens: 5, outputTokens: 0, costUsd: 0.5 }, true);
    g2.detach();
    const b = await host.open(other, { fresh: false });
    b.journal!.begin(info({ item: { id: "b" }, item_key: "b" }));
    b.journal!.nodeStart("draft", 1);
    b.journal!.usage!("draft", 1, 0, { inputTokens: 100, outputTokens: 0, costUsd: 1 }, false);
    b.detach();
    expect(host.spent!([ref])).toEqual({ tokens: 45, costUsd: 0.75 });
    expect(host.spent!([ref, other])).toEqual({ tokens: 145, costUsd: 1.75 });
    expect(host.spent!([childRef(PARENT, "draft_all", 1, "never", 2, H1, H2)])).toEqual({ tokens: 0, costUsd: 0 });
  });

  it("never prunes the workspace's runs when a child starts", async () => {
    const { host, ref, cwd, stateRoot } = setup();
    const parent = RunJournal.create({ runId: PARENT, cwd, stateRoot, keep: 1 });
    parent.begin(info());
    const run = await host.open(ref, { fresh: false });
    run.journal!.begin(info());
    run.end("success");
    expect(listJournalRuns(cwd, stateRoot)).toEqual([PARENT]);
    parent.end("success");
  });

  it("refuses to open a slot whose generation was edited", async () => {
    const { host, ref, genDir } = setup();
    const first = await host.open(ref, { fresh: false });
    first.journal!.begin(info());
    first.end("success");
    rmSync(join(genDir(1), "key"));
    // Records without their key: never recreated (that would forget their spend), never resumed.
    await expect(host.open(ref, { fresh: false })).rejects.toThrow(
      `child run ${ref.logicalId}@g1: its journal has records but no key; start a new parent run`,
    );
    // The slot lock was released on the way out.
    expect(existsSync(join(genDir(1), "..", "lock"))).toBe(false);
  });
});

describe("the memory child host", () => {
  it("opens generation 1 every time, with nothing to end", async () => {
    const host = createMemoryChildHost({ runId: "mem" });
    const ref = childRef("mem", "m", 1, "k", 0, H1, H2);
    const run = await host.open(ref, { fresh: false });
    expect([host.runId, run.runId, run.generation, run.action, run.journal]).toEqual([
      "mem",
      "mem/m#1/k@g1",
      1,
      "launch",
      undefined,
    ]);
    expect(() => {
      run.end("success");
      run.detach();
      run.crashed();
    }).not.toThrow();
    expect(createMemoryChildHost().runId).toBe("run");
  });
});

describe("journal records for map visits", () => {
  const REG: ChildRegistration = { items_hash: H1, keys: ["a", "b"], workflow_hash: H2 };
  const startRec = (over: Record<string, unknown> = {}): JournalRecord =>
    ({
      v: 3,
      seq: 1,
      type: "run:start",
      at: "t",
      run_id: PARENT,
      workflow_entry: "draft_all",
      ...over,
    }) as JournalRecord;
  const rec = (seq: number, type: string, fields: Record<string, unknown>): JournalRecord =>
    ({ v: 3, seq, type, at: "t", ...fields }) as JournalRecord;

  it("registers a map visit's children on node:start, and the plan keeps the latest per visit", () => {
    const plan = buildResumePlan([
      startRec(),
      rec(2, "node:start", { node: "draft_all", iteration: 1, children: REG }),
      rec(3, "run:resume", { attempt: 2 }),
      rec(4, "node:start", { node: "draft_all", iteration: 1, children: { ...REG, keys: ["a"] } }),
    ]);
    expect(plan.registrations.get("draft_all#1")).toEqual({ ...REG, keys: ["a"] });
    expect(plan.registrations.size).toBe(1);
    expect(plan.visits.map((v) => [v.node, v.action])).toEqual([["draft_all", "rerun"]]);
  });

  it.each([
    ["a short items hash", { ...REG, items_hash: "abc" }],
    ["an empty key", { ...REG, keys: ["a", ""] }],
    ["keys that are not a list", { ...REG, keys: "a" }],
    ["no workflow hash", { items_hash: H1, keys: [] }],
    ["not an object", ["x"]],
  ])("refuses %s", (_label, children) => {
    expect(() =>
      buildResumePlan([startRec(), rec(2, "node:start", { node: "draft_all", iteration: 1, children })]),
    ).toThrow(new JournalIntegrityError("run journal record 2 (node:start) has an invalid children registration"));
  });

  it("the journal writes the registration, and hands it back on resume with forced()", () => {
    const cwd = tmp("sweny-map-ws-");
    const stateRoot = join(tmp("sweny-map-state-"), "runs");
    const j = RunJournal.create({ runId: PARENT, cwd, stateRoot });
    j.begin(info());
    j.nodeStart("draft_all", 1, REG);
    j.nodeStart("draft_all", 1); // a restart writes its own
    j.end("crashed");
    expect(j.registration("draft_all", 1)).toBeUndefined();
    expect(j.forced()).toBe(false);
    const read = readJournal(join(journalDir(cwd, PARENT, stateRoot), JOURNAL_FILE));
    expect(read.records[1].children).toEqual(REG);
    expect("children" in read.records[2]).toBe(false);
  });

  it("does not ask to repeat writes for a map visit, whatever the workflow's permissions", () => {
    const plan = buildResumePlan([
      startRec(),
      rec(2, "node:start", { node: "draft_all", iteration: 1, children: REG }),
    ]);
    const wf = {
      id: "w",
      name: "W",
      description: "",
      spec_version: "3",
      permissions: "write",
      entry: "draft_all",
      nodes: { draft_all: { kind: "map", name: "M", skills: [] } },
      edges: [],
    } as unknown as Workflow;
    expect(mayRepeatWrites(plan, wf, {})).toEqual([]);
    const agent = { ...wf, nodes: { draft_all: { name: "A", instruction: "x", skills: [] } } } as unknown as Workflow;
    expect(mayRepeatWrites(plan, agent, {})).toEqual(["draft_all"]);
  });
});

describe("journals from before spec v3 (#575 upgrade policy)", () => {
  const start = (over: Partial<RunStartRecord> = {}) =>
    ({ run_id: PARENT, sweny_version: "0.1.215", ...over }) as RunStartRecord;
  const v3 = { spec_version: "3" } as Workflow;

  it("refuses one, naming both versions and the command that resumes it", () => {
    expect(preV3Refusal(start(), v3, "0.2.0")).toBe(
      `run ${PARENT} was journaled by sweny 0.1.215, before spec_version "3"; this sweny (0.2.0) runs the ` +
        `workflow as spec_version "3" and cannot resume it. Resume it with the sweny that started it: ` +
        `npx @sweny-ai/core@0.1.215 workflow resume ${PARENT}`,
    );
  });

  it("says so when the journal does not name its sweny", () => {
    expect(preV3Refusal(start({ sweny_version: undefined }), v3)).toBe(
      `run ${PARENT} was journaled by sweny of an unknown version, before spec_version "3"; this sweny runs the ` +
        `workflow as spec_version "3" and cannot resume it. Resume it with the sweny that started it: ` +
        `npx @sweny-ai/core@<version> workflow resume ${PARENT}`,
    );
  });

  it("lets a v3 journal resume, and a workflow that still runs below v3", () => {
    expect(preV3Refusal(start({ spec_version: "3" }), v3)).toBeUndefined();
    expect(preV3Refusal(start(), { spec_version: "2" } as Workflow)).toBeUndefined();
    expect(preV3Refusal(start(), {} as Workflow)).toBeUndefined();
  });
});
