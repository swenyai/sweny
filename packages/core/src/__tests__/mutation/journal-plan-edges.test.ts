/**
 * Edge assertions found by mutation testing of journal.ts: which record
 * sequences a resume accepts (meters, refusals, unsandboxed agents, restarts,
 * route rungs and decider counters), and what the resume plan reads out of
 * them: per-visit write counts, the decider's counters, and the spend the
 * run and each visit start from.
 */
import { describe, expect, it } from "vitest";

import {
  JOURNAL_SCHEMA_VERSION,
  JournalIntegrityError,
  buildResumePlan,
  checkRecordSequence,
  type JournalRecord,
} from "../../journal.js";
import type { NodeResult } from "../../types.js";

const RUN = "20260930-120000-0a0b0c";

/** Records numbered in order, the way the executor writes them. */
function journal(...make: Array<Record<string, unknown>>): JournalRecord[] {
  return make.map((fields, i) => ({ v: JOURNAL_SCHEMA_VERSION, seq: i + 1, at: "t", ...fields }) as JournalRecord);
}
const start = (over: Record<string, unknown> = {}) => ({
  type: "run:start",
  run_id: RUN,
  workflow_id: "w",
  workflow_entry: "a",
  workflow_hash: "wh",
  instruction_hash: "ih",
  input_hash: "nh",
  tools_hash: "th",
  input: {},
  input_redacted: false,
  ...over,
});
const ok: NodeResult = { status: "success", data: {}, toolCalls: [] };
const nodeStart = (node: string, iteration = 1) => ({ type: "node:start", node, iteration });
const checkpoint = (node: string, iteration = 1) => ({
  type: "node:checkpoint",
  node,
  iteration,
  result: ok,
  intents: [],
  agent_failed: false,
  attempt: 1,
});
const nodeEnd = (node: string, iteration = 1, result: NodeResult = ok) => ({
  type: "node:end",
  node,
  iteration,
  result,
  write_state: { counts: [], total: 0, seen: [] },
});
const route = (from: string, to: string | null, over: Record<string, unknown> = {}) => ({
  type: "route",
  from,
  to,
  ...over,
});
const meter = (kind: string, call: string, node: string, tokens = 1, cost = 0, iteration = 1) => ({
  type: "meter",
  kind,
  call,
  node,
  iteration,
  tokens,
  cost_usd: cost,
});
const usage = (node: string, tokens: number, cost: number, attempt = 0, iteration = 1) => ({
  type: "usage",
  node,
  iteration,
  attempt,
  tokens,
  cost_usd: cost,
});
const out = (type: string, node: string, key: string, over: Record<string, unknown> = {}) => ({
  type,
  node,
  iteration: 1,
  key,
  tool: "github_create_issue",
  ...over,
});

const refusedWith = (records: JournalRecord[], why: string) => {
  let err: unknown;
  try {
    checkRecordSequence(records);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(JournalIntegrityError);
  expect((err as Error).message).toContain(why);
};

describe("checkRecordSequence: meters", () => {
  it("accepts a judge, reflect and screen meter in the open visit, and a route meter before its route", () => {
    expect(() =>
      checkRecordSequence(
        journal(
          start(),
          nodeStart("a"),
          meter("judge", "c1", "a"),
          meter("reflect", "c2", "a"),
          meter("screen", "c3", "a"),
          nodeEnd("a"),
          meter("route", "c4", "a"),
          route("a", null),
        ),
      ),
    ).not.toThrow();
  });

  it("refuses a judge meter outside an open visit", () => {
    refusedWith(journal(start(), meter("judge", "c1", "a")), "record 2 (meter) is outside any open node visit");
    refusedWith(journal(start(), nodeStart("a"), meter("judge", "c1", "b")), "names b#1, but the open visit is a#1");
  });

  it("refuses a meter with an invalid token or cost amount", () => {
    refusedWith(journal(start(), nodeStart("a"), meter("judge", "c1", "a", -1, 0)), "has invalid amounts");
    refusedWith(journal(start(), nodeStart("a"), meter("judge", "c1", "a", 1, Number.NaN)), "has invalid amounts");
  });

  it("refuses a route meter naming a visit other than the one being routed", () => {
    refusedWith(
      journal(start(), nodeStart("a"), nodeEnd("a"), meter("route", "c1", "b")),
      "names b#1, but the visit being routed is a#1",
    );
    refusedWith(
      journal(start(), nodeStart("a"), nodeEnd("a"), meter("route", "c1", "a", 1, 0, 2)),
      "names a#2, but the visit being routed is a#1",
    );
  });
});

describe("checkRecordSequence: visits", () => {
  it("an unsandboxed agent record belongs to the open visit", () => {
    refusedWith(
      journal(start(), { type: "agent:unsandboxed", node: "a", iteration: 1 }),
      "record 2 (agent:unsandboxed) is outside any open node visit",
    );
    refusedWith(
      journal(start(), nodeStart("a"), { type: "agent:unsandboxed", node: "b", iteration: 1 }),
      "names b#1, but the open visit is a#1",
    );
    expect(() =>
      checkRecordSequence(journal(start(), nodeStart("a"), { type: "agent:unsandboxed", node: "a", iteration: 1 })),
    ).not.toThrow();
  });

  it("a refusal is a write: inside the open visit, after its checkpoint, matching an intent", () => {
    refusedWith(journal(start(), out("output:refused", "a", "k")), "is outside any open node visit");
    refusedWith(
      journal(start(), nodeStart("a"), out("output:refused", "a", "k")),
      "records a write before the visit's checkpoint",
    );
    refusedWith(
      journal(start(), nodeStart("a"), checkpoint("a"), out("output:refused", "a", "k")),
      "has no matching intent",
    );
    expect(() =>
      checkRecordSequence(
        journal(
          start(),
          nodeStart("a"),
          checkpoint("a"),
          out("output:intent", "a", "k"),
          out("output:refused", "a", "k"),
        ),
      ),
    ).not.toThrow();
  });

  it("restarting the open visit needs a resume in between", () => {
    refusedWith(journal(start(), nodeStart("a"), nodeStart("a")), "starts a while a is still running");
    expect(() =>
      checkRecordSequence(journal(start(), nodeStart("a"), { type: "run:resume" }, nodeStart("a"))),
    ).not.toThrow();
  });
});

describe("checkRecordSequence: routes", () => {
  const routed = (over: Record<string, unknown>) =>
    journal(start(), nodeStart("a"), nodeEnd("a"), route("a", null, over));

  it("accepts each decision rung and refuses any other", () => {
    for (const rung of ["expr", "decider", "agent"]) expect(() => checkRecordSequence(routed({ rung }))).not.toThrow();
    refusedWith(routed({ rung: "model" }), "has an unknown rung");
  });

  it("accepts whole decider counters, zero included", () => {
    for (const decider of [
      { calls: 0, failures: 0, open: false },
      { calls: 3, failures: 1, open: true },
    ]) {
      expect(() => checkRecordSequence(routed({ decider })), JSON.stringify(decider)).not.toThrow();
    }
  });

  it("refuses decider counters that are not whole non-negative counts and an open flag", () => {
    for (const decider of [
      null,
      "x",
      [],
      { calls: -1, failures: 0, open: false },
      { calls: 1.5, failures: 0, open: false },
      { calls: "1", failures: 0, open: false },
      { calls: 1, failures: -1, open: false },
      { calls: 1, open: false },
      { calls: 1, failures: 0, open: "no" },
      { calls: 1, failures: 0 },
    ]) {
      refusedWith(routed({ decider }), "has invalid decider counters");
    }
  });
});

describe("buildResumePlan: what a route leaves", () => {
  it("keeps the rung that chose a replayed visit's route", () => {
    const plan = buildResumePlan(
      journal(start(), nodeStart("a"), nodeEnd("a"), route("a", "b", { rung: "decider" }), nodeStart("b")),
    );
    expect(plan.visits[0]).toMatchObject({ node: "a", action: "replay", next: "b", rung: "decider" });
    expect(plan.visits[1]).not.toHaveProperty("rung");
  });

  it("carries the decider's mode with the counters of the last route that recorded them", () => {
    const counters = { calls: 2, failures: 1, open: false };
    const plan = buildResumePlan(
      journal(
        start({ decider: { mode: "on" } }),
        nodeStart("a"),
        nodeEnd("a"),
        route("a", "b", { rung: "decider", decider: counters }),
        nodeStart("b"),
        nodeEnd("b"),
        route("b", null),
      ),
    );
    expect(plan.decider).toStrictEqual({ mode: "on", counters });
    expect(plan.decider!.counters).not.toBe(counters);
    const none = buildResumePlan(journal(start({ decider: { mode: "off", reason: "r" } })));
    expect(none.decider).toStrictEqual({ mode: "off", reason: "r" });
    expect(buildResumePlan(journal(start())).decider).toBeUndefined();
  });
});

describe("buildResumePlan: write counts per visit", () => {
  it("counts each visit's own receipts, refusals, transient refusals and unconfirmed intents", () => {
    const plan = buildResumePlan(
      journal(
        start(),
        nodeStart("a"),
        checkpoint("a"),
        out("output:intent", "a", "k1"),
        out("output:applied", "a", "k1"),
        out("output:intent", "a", "k2"),
        out("output:refused", "a", "k2"),
        out("output:intent", "a", "k3"),
        out("output:refused", "a", "k3", { retry: true }),
        out("output:intent", "a", "k4"),
        out("output:intent", "a", "k5"),
        out("output:refused", "a", "k5"),
        out("output:applied", "a", "k5"),
        nodeEnd("a"),
        route("a", "b"),
        nodeStart("b"),
        checkpoint("b"),
        out("output:intent", "b", "k6"),
        out("output:applied", "b", "k6"),
      ),
    );
    expect(plan.visits).toStrictEqual([
      {
        node: "a",
        iteration: 1,
        action: "replay",
        status: "success",
        next: "b",
        applied: 2,
        refused: 1,
        transient: 1,
        unconfirmed: 1,
      },
      { node: "b", iteration: 1, action: "write-stage", applied: 1, refused: 0, transient: 0, unconfirmed: 0 },
    ]);
  });
});

describe("buildResumePlan: journaled spend", () => {
  // Binary fractions, so every sum is exact.
  const records = journal(
    start(),
    nodeStart("a"),
    usage("a", 10, 0.25),
    usage("a", 30, 0.5),
    meter("judge", "c1", "a", 5, 0.125),
    nodeEnd("a"),
    meter("route", "c2", "a", 2, 0.0625),
    route("a", "b"),
    nodeStart("b"),
    usage("b", 7, 0.25),
    { type: "run:resume" },
    nodeStart("b"),
    usage("b", 4, 0.125),
    meter("judge", "c3", "b", 1, 0.5),
    meter("judge", "c4", "b", 1, 0.25),
  );

  it("the run starts from each attempt's largest report, per segment, plus every metered call by kind", () => {
    expect(buildResumePlan(records).priorSpend).toStrictEqual({
      tokens: 50,
      costUsd: 1.8125,
      byKind: {
        node: { tokens: 41, costUsd: 0.875 },
        judge: { tokens: 7, costUsd: 0.875 },
        route: { tokens: 2, costUsd: 0.0625 },
      },
    });
  });

  it("each visit starts from its own attempts and judge calls, never the route call", () => {
    const spend = buildResumePlan(records).visitSpend;
    expect([...spend.entries()]).toStrictEqual([
      ["a#1", { tokens: 35, costUsd: 0.625 }],
      ["b#1", { tokens: 13, costUsd: 1.125 }],
    ]);
  });

  it("two attempts of one visit are summed, not merged", () => {
    const plan = buildResumePlan(journal(start(), nodeStart("a"), usage("a", 10, 0.25, 0), usage("a", 20, 0.5, 1)));
    expect(plan.visitSpend.get("a#1")).toStrictEqual({ tokens: 30, costUsd: 0.75 });
    expect(plan.priorSpend).toStrictEqual({ tokens: 30, costUsd: 0.75 });
  });
});
