import { describe, it, expect, afterEach, vi } from "vitest";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { Command } from "commander";

import { execute } from "./executor.js";
import { MockClaude } from "./testing.js";
import { createSkillMap } from "./skills/index.js";
import { parseWorkflow, validateWorkflow, workflowZ } from "./schema.js";
import { validateParsed } from "./loader.js";
import { formatReceipt, summarizeRun, WORKFLOW_RUN_OPTIONS } from "./cli/run-output.js";
import { RESUME_SHARED_RUN_FLAGS, prepareResume } from "./cli/resume.js";
import { operatorDeciderConfig } from "./cli/config-file.js";
import {
  JOURNAL_FILE,
  JournalIntegrityError,
  RunJournal,
  checkRecordSequence,
  journalDir,
  type JournalFaults,
  type JournalRecord,
} from "./journal.js";
import {
  DECIDER_DEFAULT_MAX_CALLS,
  DecideError,
  RunDecider,
  deciderUrlProblem,
  gateVerdict,
  hashDecisionInput,
  parseAnswers,
  resolveThresholds,
  systemOneProvider,
  type ChoiceAsk,
  type DeciderOperatorConfig,
  type DecisionProvider,
} from "./decider.js";
import { DECIDER_MODE_REMOVED, DECIDER_PROVIDER_MOVED } from "./types.js";
import type { ExecutionTrace, Logger, Workflow } from "./types.js";

// Run keys go to a scratch state dir, never the real ~/.local/state.
process.env.SWENY_STATE_DIR = mkdtempSync(join(tmpdir(), "sweny-decider-state-"));

// ─── Fake /v1/systemone server (no Ollama, no TypeSafe, no model calls) ──

interface Seen {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}
type Reply = { status?: number; json?: unknown; raw?: string; hang?: boolean; stall?: boolean };

const servers: http.Server[] = [];
const dirs: string[] = [];

async function fakeServer(reply: Reply | ((seen: Seen) => Reply)) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      let body: any;
      try {
        body = JSON.parse(data);
      } catch {
        body = undefined;
      }
      const s: Seen = { url: req.url ?? "", headers: req.headers, body };
      seen.push(s);
      const r = typeof reply === "function" ? reply(s) : reply;
      if (r.hang) return; // never answer
      res.statusCode = r.status ?? 200;
      res.setHeader("content-type", "application/json");
      if (r.stall) {
        res.write('{"answers":'); // headers and half a body, then nothing
        return;
      }
      res.end(r.raw ?? JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  servers.push(server);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl, seen };
}

/** A URL nothing listens on: a port we bound, then closed. */
async function deadUrl(): Promise<string> {
  const server = http.createServer();
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await new Promise<void>((ok) => server.close(() => ok()));
  return url;
}

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "sweny-decider-"));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections?.();
      return new Promise<void>((ok) => s.close(() => ok()));
    }),
  );
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const choice = (label: string, probs: Record<string, number>, confidence: number) => ({
  model: "nimble",
  answers: { route: { type: "choice", choice: label, probabilities: probs, confidence } },
  usage: { input_tokens: 10, output_tokens: 2 },
});

/** A confident answer for `label` over the two edge targets. */
const confident = (label: "handle_high" | "handle_low") =>
  choice(
    label,
    label === "handle_high" ? { handle_high: 0.96, handle_low: 0.04 } : { handle_high: 0.04, handle_low: 0.96 },
    0.95,
  );

/** Picks `want(keys)` from whatever criteria were sent, confidently. */
const picking = (want: (keys: string[]) => string) => (s: Seen) => {
  const keys = Object.keys(s.body.questions.route.criteria);
  const label = want(keys);
  const probs = Object.fromEntries(keys.map((k) => [k, k === label ? 0.96 : 0.04 / Math.max(1, keys.length - 1)]));
  if (keys.length === 1) probs[label] = 1;
  return { json: choice(label, probs, 0.95) };
};

const ASK: ChoiceAsk = {
  kind: "choice",
  instructions: "which?",
  criteria: { handle_high: "severity is high", handle_low: "default" },
};

const silent: Logger = { info() {}, warn() {}, error() {}, debug() {} };

function capture() {
  const lines: string[] = [];
  const warns: string[] = [];
  const logger: Logger = {
    info: (m, d) => lines.push(m + JSON.stringify(d ?? {})),
    warn: (m, d) => {
      warns.push(m);
      lines.push(m + JSON.stringify(d ?? {}));
    },
    error: (m, d) => lines.push(m + JSON.stringify(d ?? {})),
    debug: (m, d) => lines.push(m + JSON.stringify(d ?? {})),
  };
  return { logger, lines, warns };
}

const op = (url: string, extra: Partial<DeciderOperatorConfig> = {}): DeciderOperatorConfig => ({
  url,
  model: "nimble",
  allowPrivate: true,
  timeoutMs: 300,
  ...extra,
});

// ─── systemOneProvider ──────────────────────────────────────────

describe("systemOneProvider", () => {
  it("posts the System One body and parses a choice answer", async () => {
    const srv = await fakeServer({ json: choice("handle_high", { handle_high: 0.9, handle_low: 0.1 }, 0.9) });
    const p = systemOneProvider({ baseUrl: srv.baseUrl + "/", model: "nimble" });
    const out = await p.decide({ state: { a: 1 }, asks: { route: ASK } });
    expect(out.route).toMatchObject({ kind: "choice", label: "handle_high", confidence: 0.9 });
    expect({ ...out.route.probabilities }).toEqual({ handle_high: 0.9, handle_low: 0.1 });
    expect(srv.seen[0].url).toBe("/v1/systemone");
    expect(srv.seen[0].body).toEqual({
      model: "nimble",
      state: { a: 1 },
      questions: { route: { type: "choice", instructions: "which?", criteria: ASK.criteria } },
    });
    expect(srv.seen[0].headers.authorization).toBeUndefined();
  });

  it("sends the bearer key only when one is given", async () => {
    const srv = await fakeServer({ json: choice("handle_high", { handle_high: 1, handle_low: 0 }, 1) });
    await systemOneProvider({ baseUrl: srv.baseUrl, model: "jev-latest", apiKey: "k-123" }).decide({
      state: "s",
      asks: { route: ASK },
    });
    expect(srv.seen[0].headers.authorization).toBe("Bearer k-123");
  });

  it.each([
    [400, "invalid_request"],
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "http_error"],
    [422, "invalid_request"],
    [429, "rate_limited"],
    [500, "http_error"],
    [503, "overloaded"],
    [529, "overloaded"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const srv = await fakeServer({ status, json: { error: "x" } });
    const p = systemOneProvider({ baseUrl: srv.baseUrl, model: "m" });
    await expect(p.decide({ state: "s", asks: { route: ASK } })).rejects.toMatchObject({ code });
  });

  it("times out when no response arrives", async () => {
    const srv = await fakeServer({ hang: true });
    const p = systemOneProvider({ baseUrl: srv.baseUrl, model: "m" });
    await expect(p.decide({ state: "s", asks: { route: ASK }, timeoutMs: 50 })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("times out when the body stalls after the headers", async () => {
    const srv = await fakeServer({ stall: true });
    const p = systemOneProvider({ baseUrl: srv.baseUrl, model: "m" });
    await expect(p.decide({ state: "s", asks: { route: ASK }, timeoutMs: 80 })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("a refused connection is `network`, and the error names neither the URL nor the key", async () => {
    const url = await deadUrl();
    const p = systemOneProvider({ baseUrl: url, model: "m", apiKey: "sk-secret-key-123456" });
    const err = await p.decide({ state: "s", asks: { route: ASK } }).catch((e) => e);
    expect(err).toBeInstanceOf(DecideError);
    expect(err.code).toBe("network");
    const port = new URL(url).port;
    expect(`${err.message} ${err.stack}`).not.toContain(port);
    expect(`${err.message} ${err.stack}`).not.toContain("127.0.0.1");
    expect(`${err.message} ${err.stack}`).not.toContain("sk-secret");
  });
});

// ─── Strict response validation ─────────────────────────────────

describe("parseAnswers is strict", () => {
  const ok = { handle_high: 0.9, handle_low: 0.1 };
  const body = (route: Record<string, unknown>) => ({ answers: { route } });
  const ans = (c: unknown, p: unknown, conf: unknown = 0.9) => body({ choice: c, probabilities: p, confidence: conf });

  it.each<[string, unknown, string]>([
    ["not an object", "nope", "malformed"],
    ["no answers", { model: "m" }, "malformed"],
    ["answers is an array", { answers: [] }, "malformed"],
    ["missing question", { answers: {} }, "malformed"],
    ["choice is not a string", ans(1, ok), "malformed"],
    ["confidence above 1", ans("handle_high", ok, 1.5), "malformed"],
    ["confidence is a string", ans("handle_high", ok, "0.9"), "malformed"],
    ["confidence is NaN", ans("handle_high", ok, Number.NaN), "malformed"],
    ["probabilities missing", body({ choice: "handle_high", confidence: 0.9 }), "malformed"],
    // The reviewer's falsifying case: a confident answer with an incomplete distribution.
    ["incomplete probabilities", ans("handle_high", { handle_high: 1 }, 0.99), "malformed"],
    ["probability negative", ans("handle_high", { handle_high: 1.2, handle_low: -0.2 }), "malformed"],
    ["probability not a number", ans("handle_high", { handle_high: "x", handle_low: 0.1 }), "malformed"],
    ["probabilities sum to 0.9", ans("handle_high", { handle_high: 0.8, handle_low: 0.1 }), "malformed"],
    ["probabilities sum to 1.2", ans("handle_high", { handle_high: 0.9, handle_low: 0.3 }), "malformed"],
    ["chosen label is not the most probable", ans("handle_low", ok), "malformed"],
    ["tie for the top", ans("handle_high", { handle_high: 0.5, handle_low: 0.5 }), "malformed"],
    [
      "wrong answer type",
      body({ type: "score", choice: "handle_high", probabilities: ok, confidence: 0.9 }),
      "malformed",
    ],
    ["label outside the criteria", ans("rm_rf", { rm_rf: 0.95, handle_low: 0.05 }), "unknown_label"],
    ["extra label in probabilities", ans("handle_high", { handle_high: 0.9, other: 0.1 }), "unknown_label"],
    ["no case normalization", ans("Handle_High", { handle_high: 0.9, handle_low: 0.1 }), "unknown_label"],
    ["no whitespace normalization", ans(" handle_high", { handle_high: 0.9, handle_low: 0.1 }), "unknown_label"],
    ["a prototype name is not a label", ans("toString", ok), "unknown_label"],
  ])("rejects %s", (_n, input, code) => {
    let err: unknown;
    try {
      parseAnswers(input, { route: ASK });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DecideError);
    expect((err as DecideError).code).toBe(code);
  });

  it("accepts a sum within 0.01 of 1", () => {
    const out = parseAnswers(ans("handle_high", { handle_high: 0.905, handle_low: 0.1 }), { route: ASK });
    expect(out.route.label).toBe("handle_high");
  });

  it("prototype names work as real labels", () => {
    const criteria = JSON.parse('{"constructor":"c","__proto__":"p","toString":"t"}');
    const raw = JSON.parse(
      '{"answers":{"route":{"choice":"__proto__","confidence":0.9,"probabilities":{"__proto__":0.9,"constructor":0.05,"toString":0.05}}}}',
    );
    const out = parseAnswers(raw, { route: { kind: "choice", instructions: "q", criteria } });
    expect(out.route.label).toBe("__proto__");
    expect(Object.keys(out.route.probabilities).sort()).toEqual(["__proto__", "constructor", "toString"]);
  });
});

// ─── Gates and thresholds ───────────────────────────────────────

describe("gateVerdict", () => {
  const edges = new Set(["a", "b"]);
  const v = (label: string, probabilities: Record<string, number>, confidence: number) => ({
    kind: "choice" as const,
    label,
    probabilities,
    confidence,
  });

  it("accepts confidence exactly at 0.85", () => {
    expect(gateVerdict(v("a", { a: 0.9, b: 0.1 }, 0.85), edges)).toMatchObject({ accepted: true });
  });
  it("accepts a margin exactly at the threshold despite float error (0.6 - 0.4)", () => {
    expect(0.6 - 0.4 < 0.2).toBe(true); // the float bug this guards against
    expect(gateVerdict(v("a", { a: 0.6, b: 0.4 }, 0.9), edges)).toMatchObject({ accepted: true });
  });
  it("rejects low confidence", () => {
    expect(gateVerdict(v("a", { a: 0.9, b: 0.1 }, 0.84), edges)).toMatchObject({ reason: "low_confidence" });
  });
  it("rejects a thin margin", () => {
    expect(gateVerdict(v("a", { a: 0.55, b: 0.45 }, 0.99), edges)).toMatchObject({ reason: "low_margin" });
  });
  it("rejects a label outside the edge set, however confident", () => {
    expect(gateVerdict(v("z", { z: 1, a: 0 }, 1), edges)).toMatchObject({ reason: "label_outside_edge_set" });
  });
  it("never goes looser than 0.7 / 0.1, nor above 1", () => {
    expect(resolveThresholds({ min_confidence: 0.1, min_margin: 0 })).toEqual({ minConfidence: 0.7, minMargin: 0.1 });
    expect(resolveThresholds({ min_confidence: 5, min_margin: 5 })).toEqual({ minConfidence: 1, minMargin: 1 });
    expect(resolveThresholds()).toEqual({ minConfidence: 0.85, minMargin: 0.2 });
  });
  it("RunDecider clamps the thresholds it is given", () => {
    const p: DecisionProvider = { id: "f", model: "m", decide: async () => ({}) };
    expect(new RunDecider(p, { config: { min_confidence: 0.2, min_margin: 0.01 } }).thresholds).toEqual({
      minConfidence: 0.7,
      minMargin: 0.1,
    });
  });
});

describe("hashDecisionInput", () => {
  it("is stable, short, and does not contain the input", () => {
    const h = hashDecisionInput({ secret: "tok-123" }, { a: "d" });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain("tok-123");
    expect(h).toBe(hashDecisionInput({ secret: "tok-123" }, { a: "d" }));
    expect(h).not.toBe(hashDecisionInput({ secret: "tok-124" }, { a: "d" }));
  });
});

// ─── URL policy ─────────────────────────────────────────────────

describe("decider URL policy", () => {
  it.each<[string, boolean, RegExp | null]>([
    ["https://api.typesafe.ai", false, null],
    ["http://localhost:11434", false, /private/],
    ["http://localhost:11434", true, null],
    ["http://127.0.0.1:11434", false, /private/],
    ["http://2130706433/", false, /private/], // 127.0.0.1 in decimal
    ["http://10.1.2.3", false, /private/],
    ["http://172.20.0.1", false, /private/],
    ["http://192.168.1.10", false, /private/],
    ["http://[::1]:11434", false, /private/],
    ["http://[::1]:11434", true, null],
    ["http://[fd12::1]", false, /private/],
    ["http://169.254.169.254/latest", true, /metadata/],
    ["http://[fe80::1]", true, /metadata/],
    ["http://[::ffff:169.254.169.254]", true, /metadata/],
    ["http://[::ffff:127.0.0.1]", false, /private/],
    ["http://metadata.google.internal", true, /metadata/],
    ["http://[fd00:ec2::254]", true, /metadata/],
    ["http://0.0.0.0:11434", true, /metadata|reserved/],
    ["file:///etc/passwd", true, /http or https/],
    ["ftp://example.com", true, /http or https/],
    ["https://user:pass@api.typesafe.ai", false, /credentials/],
    ["not a url", false, /valid URL/],
  ])("%s (allow_private %s)", (url, allow, problem) => {
    const got = deciderUrlProblem(url, allow);
    if (problem === null) expect(got).toBeNull();
    else expect(got).toMatch(problem);
  });
});

// ─── Executor: the route ladder ─────────────────────────────────

const OUTPUT = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["high", "low"] },
    count: { type: "integer" },
    note: { type: "string" },
  },
};

function wf(
  opts: {
    decider?: Workflow["decider"];
    routeBy?: "agent" | "decider" | null;
    withDefault?: boolean;
    expressions?: boolean;
    output?: Record<string, unknown>;
    conditions?: [string, string];
  } = {},
): Workflow {
  const [hi, lo] = opts.conditions ?? ["severity is high", "severity is low"];
  const edges: Workflow["edges"] = opts.expressions
    ? [
        { from: "check", to: "handle_high", when: { expr: "check.severity == 'high'" } },
        { from: "check", to: "handle_low", when: { expr: "check.severity != 'high'" } },
      ]
    : [
        { from: "check", to: "handle_high", when: hi },
        opts.withDefault ? { from: "check", to: "handle_low" } : { from: "check", to: "handle_low", when: lo },
      ];
  const routeBy = opts.routeBy === undefined ? "decider" : opts.routeBy;
  return {
    id: "decider-test",
    name: "Decider Test",
    description: "",
    entry: "check",
    ...(opts.decider ? { decider: opts.decider } : {}),
    nodes: {
      check: {
        name: "Check",
        instruction: "SECRET-INSTRUCTION examine the alert",
        skills: [],
        output: opts.output ?? OUTPUT,
        ...(routeBy ? { route_by: routeBy } : {}),
      },
      handle_high: { name: "High", instruction: "handle high", skills: [] },
      handle_low: { name: "Low", instruction: "handle low", skills: [] },
      done: { name: "Done", instruction: "done", skills: [] },
    },
    edges: [...edges, { from: "handle_high", to: "done" }, { from: "handle_low", to: "done" }],
  };
}

const SECRET = "s3cr3t-value-for-the-test";

function runWith(
  workflow: Workflow,
  route: string | undefined,
  extra: { decider?: DeciderOperatorConfig | false; env?: NodeJS.ProcessEnv; logger?: Logger; input?: unknown } = {},
) {
  const claude = new MockClaude({
    workflow,
    responses: {
      check: { data: { severity: "high", count: 3, note: `uses ${SECRET} FREE-TEXT`, extra: "UNDECLARED-DATA" } },
      handle_high: {},
      handle_low: {},
      done: {},
    },
    routes: route ? { check: route } : {},
  });
  const evaluate = vi.spyOn(claude, "evaluate");
  return execute(workflow, extra.input ?? {}, {
    skills: createSkillMap([]),
    claude,
    config: {},
    env: extra.env ?? {},
    ...(extra.decider !== undefined ? { decider: extra.decider } : {}),
    logger: extra.logger ?? silent,
  }).then((r) => ({ ...r, evaluate, claude }));
}

describe("the decider decides", () => {
  it("takes the decider's route when every gate passes, and never calls the agent", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    // The agent would have picked handle_high: the route proves who decided.
    const { results, trace, evaluate } = await runWith(wf(), "handle_high", { decider: op(srv.baseUrl) });
    expect(results.has("handle_low")).toBe(true);
    expect(results.has("handle_high")).toBe(false);
    expect(evaluate).not.toHaveBeenCalled();
    expect(srv.seen).toHaveLength(1);
    expect(trace.edges[0]).toMatchObject({ from: "check", to: "handle_low", rung: "decider" });
    expect(trace.decisions![0]).toMatchObject({ node: "check", outcome: "decided", label: "handle_low" });
    expect(trace.decisions![0].margin).toBeCloseTo(0.92);
    expect(trace.edges[1]).toEqual({ from: "handle_low", to: "done", reason: "only path" });
    expect(trace.deciderOff).toBeUndefined();
  });

  it("only route_by: decider nodes consult it; the default is the agent", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    for (const routeBy of [null, "agent"] as const) {
      const { results, trace, evaluate } = await runWith(wf({ routeBy }), "handle_high", {
        decider: op(srv.baseUrl),
      });
      expect(results.has("handle_high")).toBe(true);
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(trace.edges[0].rung).toBe("agent");
      expect(trace.deciderOff).toBeUndefined();
    }
    expect(srv.seen).toHaveLength(0);
  });

  it("may pick the default edge", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { results, evaluate } = await runWith(wf({ withDefault: true }), "handle_high", {
      decider: op(srv.baseUrl),
    });
    expect(results.has("handle_low")).toBe(true);
    expect(evaluate).not.toHaveBeenCalled();
    expect(srv.seen[0].body.questions.route.criteria).toEqual({
      handle_high: "severity is high",
      handle_low: "None of the above / default path",
    });
  });

  it("honors the workflow's own thresholds", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { results, evaluate, trace } = await runWith(wf({ decider: { min_confidence: 0.97 } }), "handle_high", {
      decider: op(srv.baseUrl),
    });
    expect(results.has("handle_high")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(trace.decisions![0]).toMatchObject({ outcome: "fell_through", reason: "low_confidence" });
  });

  it("a node named constructor routes through the decider to nodes named toString and valueOf", async () => {
    const srv = await fakeServer(picking(() => "toString"));
    const workflow: Workflow = {
      id: "proto",
      name: "Proto",
      description: "",
      entry: "constructor",
      nodes: {
        constructor: { name: "C", instruction: "c", skills: [], output: OUTPUT, route_by: "decider" },
        toString: { name: "T", instruction: "t", skills: [] },
        valueOf: { name: "V", instruction: "v", skills: [] },
      },
      edges: [
        { from: "constructor", to: "toString", when: "go to toString" },
        { from: "constructor", to: "valueOf", when: "go to valueOf" },
      ],
    };
    const claude = new MockClaude({
      workflow,
      responses: { constructor: { data: { severity: "low", count: 1 } }, toString: {}, valueOf: {} },
    });
    const { results, trace } = await execute(
      workflow,
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        env: {},
        logger: silent,
        decider: op(srv.baseUrl),
      },
    );
    expect(results.has("toString")).toBe(true);
    expect(trace.edges[0]).toMatchObject({ from: "constructor", to: "toString", rung: "decider" });
    expect(Object.keys(srv.seen[0].body.questions.route.criteria)).toEqual(["toString", "valueOf"]);
  });

  it("an exhausted max_iterations edge is not offered to the decider", async () => {
    const srv = await fakeServer(picking((keys) => (keys.includes("retry") ? "retry" : "done")));
    const workflow: Workflow = {
      id: "loop",
      name: "Loop",
      description: "",
      entry: "check",
      nodes: {
        check: { name: "C", instruction: "c", skills: [], output: OUTPUT, route_by: "decider" },
        retry: { name: "R", instruction: "r", skills: [] },
        done: { name: "D", instruction: "d", skills: [] },
      },
      edges: [
        { from: "check", to: "retry", when: "needs another pass", max_iterations: 1 },
        { from: "check", to: "done", when: "finished" },
        { from: "retry", to: "check" },
      ],
    };
    const claude = new MockClaude({
      workflow,
      responses: { check: { data: { severity: "low", count: 1 } }, retry: {}, done: {} },
    });
    const { results } = await execute(
      workflow,
      {},
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        env: {},
        logger: silent,
        decider: op(srv.baseUrl),
      },
    );
    expect(results.has("done")).toBe(true);
    expect(srv.seen).toHaveLength(2);
    expect(Object.keys(srv.seen[0].body.questions.route.criteria).sort()).toEqual(["done", "retry"]);
    expect(Object.keys(srv.seen[1].body.questions.route.criteria)).toEqual(["done"]);
  });
});

describe("every failure falls through to the agent", () => {
  const cases: Array<[string, Reply, string]> = [
    ["timeout", { hang: true }, "timeout"],
    ["stalled body", { stall: true }, "timeout"],
    ["400", { status: 400 }, "invalid_request"],
    ["401", { status: 401 }, "unauthorized"],
    ["403", { status: 403 }, "unauthorized"],
    ["404", { status: 404 }, "http_error"],
    ["422", { status: 422 }, "invalid_request"],
    ["429", { status: 429 }, "rate_limited"],
    ["500", { status: 500 }, "http_error"],
    ["503", { status: 503 }, "overloaded"],
    ["529", { status: 529 }, "overloaded"],
    ["malformed JSON", { raw: "nope" }, "malformed"],
    ["missing answers", { json: { model: "nimble" } }, "malformed"],
    ["incomplete probabilities", { json: choice("handle_low", { handle_low: 1 }, 0.99) }, "malformed"],
    ["low confidence", { json: choice("handle_low", { handle_high: 0.1, handle_low: 0.9 }, 0.6) }, "low_confidence"],
    ["low margin", { json: choice("handle_low", { handle_high: 0.45, handle_low: 0.55 }, 0.95) }, "low_margin"],
    ["label that is no edge", { json: choice("rm_rf", { rm_rf: 1, handle_low: 0 }, 0.99) }, "unknown_label"],
    [
      "label of a real node that is not an out-edge here",
      { json: choice("done", { done: 0.99, handle_low: 0.01 }, 0.99) },
      "unknown_label",
    ],
  ];
  it.each(cases)("%s: the agent routes, the reason is recorded", async (_n, reply, reason) => {
    const srv = await fakeServer(reply);
    const { results, trace, evaluate } = await runWith(wf(), "handle_high", { decider: op(srv.baseUrl) });
    expect(results.has("handle_high")).toBe(true);
    expect(results.has("handle_low")).toBe(false);
    expect(results.has("done")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(trace.edges[0]).toMatchObject({ from: "check", to: "handle_high", rung: "agent" });
    expect(trace.decisions![0]).toMatchObject({ outcome: "fell_through", reason });
  });

  it("an unreachable provider: the agent routes", async () => {
    const { results, trace, evaluate } = await runWith(wf(), "handle_high", { decider: op(await deadUrl()) });
    expect(results.has("handle_high")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(trace.decisions![0]).toMatchObject({ outcome: "fell_through", reason: "network" });
  });

  it("a fall-through keeps the agent's fail-closed rules: a failed agent eval takes the default edge", async () => {
    const srv = await fakeServer({ status: 500 });
    const { results, trace } = await runWith(wf({ withDefault: true }), undefined, { decider: op(srv.baseUrl) });
    expect(results.has("handle_low")).toBe(true);
    expect(trace.edges[0]).toMatchObject({ to: "handle_low", rung: "agent" });
  });
});

describe("expressions come first", () => {
  it("an expression node never asks the decider or the agent, even with route_by: decider", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { results, trace, evaluate } = await runWith(wf({ expressions: true }), "handle_low", {
      decider: op(srv.baseUrl),
    });
    expect(results.has("handle_high")).toBe(true);
    expect(srv.seen).toHaveLength(0);
    expect(evaluate).not.toHaveBeenCalled();
    expect(trace.edges[0]).toMatchObject({ to: "handle_high", rung: "expr" });
  });
});

describe("routable state", () => {
  it("sends only declared typed fields, fenced and redacted; never free text, input, env or instructions", async () => {
    const srv = await fakeServer({ json: confident("handle_high") });
    const { logger, lines } = capture();
    const token = "ghp_" + "a".repeat(36);
    const output = {
      type: "object",
      properties: { ...OUTPUT.properties, tag: { type: "string", enum: ["ok", token] } },
    };
    const workflow = wf({ output });
    const claude = new MockClaude({
      workflow,
      responses: {
        check: {
          data: {
            severity: "high",
            count: 2.5,
            note: `uses ${SECRET} FREE-TEXT`,
            extra: "UNDECLARED-DATA",
            tag: token,
          },
        },
        handle_high: {},
        handle_low: {},
        done: {},
      },
    });
    const { trace } = await execute(
      workflow,
      { ticket: "INPUT-DATA" },
      {
        skills: createSkillMap([]),
        claude,
        config: {},
        env: { MY_API_TOKEN: SECRET, HOME_DIR_PATH: "/home/runner-ENV-VALUE" },
        logger,
        decider: op(srv.baseUrl),
      },
    );
    const state: string = srv.seen[0].body.state;
    expect(state).toContain("<untrusted-data");
    expect(state).toContain('"severity": "high"');
    expect(state).toContain('"count": null'); // 2.5 is not an integer: never sent
    expect(state).toContain("[redacted]");
    for (const leak of [
      token,
      SECRET,
      "FREE-TEXT",
      "UNDECLARED-DATA",
      "SECRET-INSTRUCTION",
      "INPUT-DATA",
      "ENV-VALUE",
    ]) {
      expect(state).not.toContain(leak);
    }
    expect(state).not.toContain('"note"');

    const deciderLines = lines.filter((l) => l.includes("decider"));
    expect(deciderLines.length).toBeGreaterThan(0);
    const logged = deciderLines.join("\n") + JSON.stringify(trace.decisions);
    for (const leak of ["UNDECLARED-DATA", SECRET, "severity is high"]) expect(logged).not.toContain(leak);
  });

  it.each<[string, Partial<Parameters<typeof wf>[0]>]>([
    ["a condition reads input.*", { conditions: ["input.priority is urgent", "anything else"] }],
    [
      "the routed node declares no routable field",
      { output: { type: "object", properties: { note: { type: "string" } } } },
    ],
    ["the routed node declares no output", { output: {} }],
    ["a condition names a node with no routable field", { conditions: ["handle_low.result looks done", "otherwise"] }],
  ])("%s: skipped with no_routable_state, no HTTP, the agent routes", async (_n, opts) => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { results, trace, evaluate } = await runWith(wf(opts), "handle_high", { decider: op(srv.baseUrl) });
    expect(srv.seen).toHaveLength(0);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(results.has("handle_high")).toBe(true);
    expect(trace.decisions![0]).toMatchObject({ outcome: "skipped", reason: "no_routable_state" });
  });
});

describe("operator config and turning it off", () => {
  it("no operator config: zero HTTP, the agent routes, and the receipt says why once", async () => {
    const { results, trace, evaluate } = await runWith(wf(), "handle_high");
    expect(results.has("handle_high")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(trace.decisions).toBeUndefined();
    expect(trace.deciderOff).toMatch(/no operator config/);
    expect(formatReceipt(summarizeRun(new Map(), 1, false, trace))).toContain("decider off: no operator config");
  });

  it("--no-decider (decider: false): zero HTTP", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { trace, evaluate } = await runWith(wf(), "handle_high", { decider: false });
    expect(srv.seen).toHaveLength(0);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(trace.deciderOff).toMatch(/--no-decider/);
  });

  it("a workflow with no route_by: decider node says nothing about the decider", async () => {
    const { trace } = await runWith(wf({ routeBy: null }), "handle_high");
    expect(trace.deciderOff).toBeUndefined();
  });

  it("localhost without allow_private is refused before any HTTP", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { trace } = await runWith(wf(), "handle_high", { decider: op(srv.baseUrl, { allowPrivate: false }) });
    expect(srv.seen).toHaveLength(0);
    expect(trace.deciderOff).toMatch(/allow_private/);
  });

  it("a metadata address is refused even with allow_private", async () => {
    const { trace } = await runWith(wf(), "handle_high", { decider: op("http://169.254.169.254") });
    expect(trace.deciderOff).toMatch(/metadata/);
  });

  it("sends the operator's key as a bearer token", async () => {
    const srv = await fakeServer({ json: confident("handle_high") });
    await runWith(wf(), "handle_high", { decider: op(srv.baseUrl, { apiKey: "sk-test" }) });
    expect(srv.seen[0].headers.authorization).toBe("Bearer sk-test");
  });
});

describe("CLI operator config", () => {
  const file = { "decider.url": "http://localhost:11434", "decider.model": "nimble", "decider.allow_private": "true" };

  it("reads .sweny.yml, env wins, the key only from SWENY_DECIDER_API_KEY", () => {
    expect(operatorDeciderConfig(file, {}, false)).toEqual({
      url: "http://localhost:11434",
      model: "nimble",
      allowPrivate: true,
    });
    expect(
      operatorDeciderConfig(
        { ...file, "decider.api_key": "from-file" },
        { SWENY_DECIDER_URL: "https://api.typesafe.ai", SWENY_DECIDER_MODEL: "jev-latest", SWENY_DECIDER_API_KEY: "k" },
        false,
      ),
    ).toEqual({ url: "https://api.typesafe.ai", model: "jev-latest", apiKey: "k", allowPrivate: true });
    expect(operatorDeciderConfig({}, { SWENY_DECIDER_URL: "https://x.test" }, false)).toBeUndefined();
    expect(operatorDeciderConfig({}, {}, false)).toBeUndefined();
  });

  it("--no-decider parses to decider: false and turns the operator config off", () => {
    const cmd = new Command().exitOverride();
    for (const [flags, description] of WORKFLOW_RUN_OPTIONS) cmd.option(flags, description);
    expect(RESUME_SHARED_RUN_FLAGS).toContain("--no-decider");
    const off = cmd.parse(["--no-decider"], { from: "user" }).opts();
    expect(off.decider).toBe(false);
    expect(operatorDeciderConfig(file, {}, off.decider === false)).toBe(false);
    const on = new Command();
    for (const [flags, description] of WORKFLOW_RUN_OPTIONS) on.option(flags, description);
    expect(operatorDeciderConfig(file, {}, on.parse([], { from: "user" }).opts().decider === false)).not.toBe(false);
  });
});

// ─── Reliability: breaker and cap ───────────────────────────────

const Q = (node = "n") => ({
  node,
  question: "which?",
  state: "s",
  choices: [
    { id: "handle_high", description: "high" },
    { id: "handle_low", description: "low" },
  ],
});

/** A provider that answers from a script: "fail", "abort", "low" (valid, low confidence) or "ok". */
function scripted(script: string[]) {
  let calls = 0;
  const provider: DecisionProvider = {
    id: "fake",
    model: "m",
    async decide() {
      const s = script[calls++] ?? "ok";
      if (s === "fail") throw new DecideError("http_error", "HTTP 500");
      if (s === "abort") throw new DecideError("aborted", "request aborted");
      const confidence = s === "low" ? 0.5 : 0.95;
      return {
        route: {
          kind: "choice",
          label: "handle_high",
          probabilities: { handle_high: 0.96, handle_low: 0.04 },
          confidence,
        },
      };
    },
  };
  return { provider, calls: () => calls };
}

describe("circuit breaker", () => {
  it("after 3 consecutive failures it stops calling for the rest of the run, and says so once", async () => {
    const { provider, calls } = scripted(Array(10).fill("fail"));
    const warns: string[] = [];
    const d = new RunDecider(provider, { warn: (m) => warns.push(m) });
    for (let i = 0; i < 6; i++) expect(await d.decide(Q())).toBeNull();
    expect(calls()).toBe(3);
    expect(d.counters).toEqual({ calls: 3, failures: 3, open: true });
    expect(d.offReason).toMatch(/breaker open/);
    expect(warns).toHaveLength(1);
  });

  it("aborted calls do not trip it", async () => {
    const { provider, calls } = scripted(Array(6).fill("abort"));
    const d = new RunDecider(provider);
    for (let i = 0; i < 6; i++) await d.decide(Q());
    expect(calls()).toBe(6);
    expect(d.counters.open).toBe(false);
  });

  it("a gate rejection (a valid low-confidence answer) resets the streak", async () => {
    const { provider, calls } = scripted(["fail", "fail", "low", "fail", "fail", "ok"]);
    const d = new RunDecider(provider);
    const got = [];
    for (let i = 0; i < 6; i++) got.push(await d.decide(Q()));
    expect(calls()).toBe(6);
    expect(d.counters.open).toBe(false);
    expect(got).toEqual([null, null, null, null, null, "handle_high"]);
  });

  it("trips across nodes in one execute() run, and each run has its own breaker", async () => {
    const srv = await fakeServer({ status: 500 });
    for (let run = 1; run <= 2; run++) {
      const { trace, results } = await runLoop(op(srv.baseUrl));
      expect(results.has("end_b")).toBe(true);
      expect(srv.seen).toHaveLength(3 * run);
      expect(trace.deciderOff).toMatch(/breaker open/);
      expect(new Set(trace.decisions!.map((d) => d.node))).toEqual(new Set(["a", "b"]));
    }
  });
});

describe("per-run call cap", () => {
  it("defaults to 200: call 201 is never made", async () => {
    const { provider, calls } = scripted([]);
    const warns: string[] = [];
    const d = new RunDecider(provider, { warn: (m) => warns.push(m) });
    expect(DECIDER_DEFAULT_MAX_CALLS).toBe(200);
    for (let i = 0; i < 200; i++) expect(await d.decide(Q())).toBe("handle_high");
    expect(await d.decide(Q())).toBeNull();
    expect(calls()).toBe(200);
    expect(d.offReason).toBe("call cap of 200 reached");
    expect(warns).toHaveLength(1);
  });

  it("honors the operator's cap", async () => {
    const { provider, calls } = scripted([]);
    const d = new RunDecider(provider, { maxCalls: 2 });
    for (let i = 0; i < 4; i++) await d.decide(Q());
    expect(calls()).toBe(2);
  });
});

// ─── a <-> b loop: 7 conditional routes across two route_by nodes ─

function loop(): Workflow {
  const node = (id: string) => ({
    name: id,
    instruction: `node ${id}`,
    skills: [] as string[],
    output: { type: "object", properties: { flag: { type: "boolean" } } },
    route_by: "decider" as const,
  });
  return {
    id: "loop",
    name: "Loop",
    description: "",
    entry: "a",
    nodes: {
      a: node("a"),
      b: node("b"),
      end_a: { name: "end_a", instruction: "end a", skills: [] },
      end_b: { name: "end_b", instruction: "end b", skills: [] },
    },
    edges: [
      { from: "a", to: "b", when: "go to b" },
      { from: "a", to: "end_a" },
      { from: "b", to: "a", when: "go to a", max_iterations: 3 },
      { from: "b", to: "end_b" },
    ],
  };
}

function loopClaude(workflow: Workflow) {
  return new MockClaude({
    workflow,
    responses: { a: { data: { flag: true } }, b: { data: { flag: true } }, end_a: {}, end_b: {} },
    routes: { a: "b", b: "a" },
  });
}

function runLoop(decider: DeciderOperatorConfig | false, journal?: RunJournal) {
  const workflow = loop();
  return execute(
    workflow,
    {},
    {
      skills: createSkillMap([]),
      claude: loopClaude(workflow),
      config: {},
      env: {},
      logger: silent,
      decider,
      ...(journal ? { journal } : {}),
    },
  );
}

// ─── Journal and resume ─────────────────────────────────────────

const RUN_ID = "20261001-120000-dec357";
const killAt = (node: string, iteration = 1): JournalFaults => ({
  beforeAppend(rec: JournalRecord) {
    if (rec.type === "node:start" && rec.node === node && rec.iteration === iteration) throw new Error("killed");
  },
});
const records = (cwd: string) =>
  readFileSync(join(journalDir(cwd, RUN_ID), JOURNAL_FILE), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

async function resumeWith(cwd: string, workflow: Workflow, claude: MockClaude, decider: DeciderOperatorConfig | false) {
  const prepared = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => workflow });
  if (!prepared.ok || "planOnly" in prepared) throw new Error("resume refused");
  const out = await execute(workflow, prepared.ctx.input, {
    skills: createSkillMap([]),
    claude,
    config: {},
    env: {},
    logger: silent,
    decider,
    journal: prepared.ctx.journal,
  });
  prepared.ctx.journal.end("success");
  return out;
}

describe("journal and resume", () => {
  function decided(cwd: string, url: string) {
    const workflow = wf();
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults: killAt("handle_low") });
    const first = new MockClaude({
      workflow,
      responses: { check: { data: { severity: "high", count: 1 } }, handle_high: {}, handle_low: {}, done: {} },
      routes: { check: "handle_high" },
    });
    const firstEval = vi.spyOn(first, "evaluate");
    return execute(
      workflow,
      {},
      {
        skills: createSkillMap([]),
        claude: first,
        config: {},
        env: {},
        logger: silent,
        journal,
        decider: op(url),
      },
    )
      .catch(() => undefined)
      .then(() => ({ workflow, firstEval }));
  }
  const second = (workflow: Workflow) =>
    new MockClaude({
      workflow,
      responses: { check: { data: { severity: "high", count: 1 } }, handle_high: {}, handle_low: {}, done: {} },
      routes: { check: "handle_high" },
    });

  it("records the mode and the rung, and resume replays the decided route without the decider or the agent", async () => {
    const cwd = tmp();
    const srv = await fakeServer({ json: confident("handle_low") });
    const { workflow, firstEval } = await decided(cwd, srv.baseUrl);
    expect(firstEval).not.toHaveBeenCalled();
    const recs = records(cwd);
    expect(recs[0]).toMatchObject({ type: "run:start", decider: { mode: "on" } });
    expect(recs.find((r) => r.type === "route")).toMatchObject({
      from: "check",
      to: "handle_low",
      rung: "decider",
      decider: { calls: 1, failures: 0, open: false },
    });

    const claude = second(workflow);
    const ev = vi.spyOn(claude, "evaluate");
    const { results, trace } = await resumeWith(cwd, workflow, claude, op(srv.baseUrl));
    expect(srv.seen).toHaveLength(1);
    expect(ev).not.toHaveBeenCalled();
    expect(claude.executedNodes).toEqual(["handle_low", "done"]);
    expect(results.has("handle_high")).toBe(false);
    expect(trace.edges[0]).toMatchObject({ from: "check", to: "handle_low", rung: "decider" });
  });

  it("resume with --no-decider still replays the journaled decider route", async () => {
    const cwd = tmp();
    const srv = await fakeServer({ json: confident("handle_low") });
    const { workflow } = await decided(cwd, srv.baseUrl);
    const claude = second(workflow);
    const ev = vi.spyOn(claude, "evaluate");
    const { results, trace } = await resumeWith(cwd, workflow, claude, false);
    expect(srv.seen).toHaveLength(1);
    expect(ev).not.toHaveBeenCalled();
    expect(results.has("handle_low")).toBe(true);
    expect(trace.edges[0]).toMatchObject({ to: "handle_low", rung: "decider" });
    expect(trace.deciderOff).toMatch(/--no-decider/);
  });

  it("journals the expr and agent rungs too", async () => {
    for (const [opts, rung] of [
      [{ expressions: true }, "expr"],
      [{ routeBy: null }, "agent"],
    ] as const) {
      const cwd = tmp();
      const workflow = wf(opts);
      const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml" });
      await execute(
        workflow,
        {},
        {
          skills: createSkillMap([]),
          claude: second(workflow),
          config: {},
          env: {},
          logger: silent,
          journal,
        },
      );
      journal.end("success");
      expect(records(cwd).find((r) => r.type === "route" && r.from === "check")).toMatchObject({ rung });
    }
  });

  it("an unknown rung or bad counters in a route record are refused", () => {
    const base = [
      { type: "run:start", run_id: "r", workflow_entry: "a" },
      { type: "node:start", node: "a", iteration: 1 },
      { type: "node:end", node: "a", iteration: 1, result: { status: "success" } },
    ];
    const seq = (route: Record<string, unknown>) => [...base, { type: "route", from: "a", to: null, ...route }];
    expect(() => checkRecordSequence(seq({ rung: "decider" }) as unknown as JournalRecord[])).not.toThrow();
    expect(() => checkRecordSequence(seq({ rung: "magic" }) as unknown as JournalRecord[])).toThrow(
      JournalIntegrityError,
    );
    expect(() =>
      checkRecordSequence(seq({ decider: { calls: -1, failures: 0, open: false } }) as unknown as JournalRecord[]),
    ).toThrow(JournalIntegrityError);
  });

  it("the breaker continues across a resume: it is per logical run", async () => {
    const cwd = tmp();
    const srv = await fakeServer({ status: 500 });
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults: killAt("a", 2) });
    await runLoop(op(srv.baseUrl), journal).catch(() => undefined);
    expect(srv.seen).toHaveLength(2); // a->b and b->a both failed, then the process died

    const workflow = loop();
    const { trace } = await resumeWith(cwd, workflow, loopClaude(workflow), op(srv.baseUrl));
    // One more failure trips the carried-over streak of 2; a fresh breaker would have made 3 more calls.
    expect(srv.seen).toHaveLength(3);
    expect(trace.deciderOff).toMatch(/breaker open/);
  });

  it("the call cap continues across a resume", async () => {
    const cwd = tmp();
    const srv = await fakeServer(picking((keys) => keys.find((k) => !k.startsWith("end_")) ?? keys[0]));
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults: killAt("a", 2) });
    await runLoop(op(srv.baseUrl, { maxCalls: 3 }), journal).catch(() => undefined);
    expect(srv.seen).toHaveLength(2);

    const workflow = loop();
    const { trace } = await resumeWith(cwd, workflow, loopClaude(workflow), op(srv.baseUrl, { maxCalls: 3 }));
    expect(srv.seen).toHaveLength(3);
    expect(trace.deciderOff).toBe("call cap of 3 reached");
  });

  it("a run that started with the decider off stays off on resume", async () => {
    const cwd = tmp();
    const srv = await fakeServer({ json: confident("handle_low") });
    const workflow = wf();
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults: killAt("handle_high") });
    await execute(
      workflow,
      {},
      {
        skills: createSkillMap([]),
        claude: second(workflow),
        config: {},
        env: {},
        logger: silent,
        journal,
      },
    ).catch(() => undefined);
    expect(records(cwd)[0]).toMatchObject({ decider: { mode: "off" } });

    const { trace } = await resumeWith(cwd, workflow, second(workflow), op(srv.baseUrl));
    expect(srv.seen).toHaveLength(0);
    expect(trace.deciderOff).toMatch(/off since this run started/);
  });
});

// ─── Receipt ────────────────────────────────────────────────────

describe("receipt", () => {
  const trace = (edges: ExecutionTrace["edges"], extra: Partial<ExecutionTrace> = {}): ExecutionTrace => ({
    steps: [],
    edges,
    sources: {},
    ...extra,
  });
  const e = (rung?: "expr" | "decider" | "agent") => ({ from: "a", to: "b", reason: "r", ...(rung ? { rung } : {}) });

  it("prints `routes 5 (3 decider, 1 expr, 1 agent)`", () => {
    const s = summarizeRun(
      new Map(),
      1000,
      false,
      trace([e("decider"), e("decider"), e("expr"), e(), e("decider"), e("agent")]),
    );
    expect(s.routes).toEqual({ total: 5, decider: 3, expr: 1, agent: 1 });
    expect(formatReceipt(s)).toContain(" · routes 5 (3 decider, 1 expr, 1 agent)");
  });

  it("prints routes whenever there are any, decider or not", () => {
    expect(formatReceipt(summarizeRun(new Map(), 1000, false, trace([e("agent"), e("agent")])))).toContain(
      " · routes 2 (2 agent)",
    );
    expect(formatReceipt(summarizeRun(new Map(), 1000, false, trace([e()])))).not.toContain("routes");
  });

  it("prints `decider off: <reason>` once", () => {
    const line = formatReceipt(
      summarizeRun(new Map(), 1000, false, trace([e("agent")], { deciderOff: "breaker open after 3 failed calls" })),
    );
    expect(line).toContain(" · decider off: breaker open after 3 failed calls");
    expect(line.match(/decider off/g)).toHaveLength(1);
    expect(line).not.toMatch(/agreed|shadow/);
  });
});

// ─── Config and migration safety ────────────────────────────────

describe("workflow config", () => {
  const base = {
    id: "w",
    name: "W",
    entry: "a",
    nodes: { a: { name: "A", instruction: "x", skills: [] } },
    edges: [],
  };

  it("accepts thresholds within the floors and route_by on nodes", () => {
    expect(workflowZ.safeParse({ ...base, decider: { min_confidence: 0.9, min_margin: 0.25 } }).success).toBe(true);
    expect(workflowZ.safeParse({ ...base, decider: {} }).success).toBe(true);
    for (const route_by of ["agent", "decider"]) {
      expect(workflowZ.safeParse({ ...base, nodes: { a: { ...base.nodes.a, route_by } } }).success).toBe(true);
    }
    expect(workflowZ.safeParse({ ...base, nodes: { a: { ...base.nodes.a, route_by: "model" } } }).success).toBe(false);
  });

  it("refuses thresholds looser than 0.7 / 0.1", () => {
    expect(workflowZ.safeParse({ ...base, decider: { min_confidence: 0.69 } }).success).toBe(false);
    expect(workflowZ.safeParse({ ...base, decider: { min_margin: 0.09 } }).success).toBe(false);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["mode: shadow", { mode: "shadow" }, DECIDER_MODE_REMOVED],
    ["mode: off", { mode: "off" }, DECIDER_MODE_REMOVED],
    ["a provider", { provider: { base_url: "http://169.254.169.254", model: "m" } }, DECIDER_PROVIDER_MOVED],
  ])("a workflow with %s fails to load with an explanation, never silently routes", (_n, decider, message) => {
    const parsed = workflowZ.safeParse({ ...base, decider });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.message)).toContain(message);
    const loaded = validateParsed({ ...base, decider });
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.errors.map((x) => x.message).join("\n")).toContain(message);
    expect(() => parseWorkflow({ ...base, decider })).toThrow();
  });

  it("refuses duplicate (from, to) edges", () => {
    const w = {
      ...base,
      nodes: { a: base.nodes.a, b: { name: "B", instruction: "y", skills: [] } },
      edges: [
        { from: "a", to: "b", when: "x" },
        { from: "a", to: "b", when: "y" },
      ],
    } as unknown as Workflow;
    expect(validateWorkflow(w).map((e) => e.code)).toContain("DUPLICATE_EDGE");
  });
});
