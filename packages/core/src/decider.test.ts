import { describe, it, expect, afterEach, vi } from "vitest";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";

import { execute } from "./executor.js";
import { MockClaude } from "./testing.js";
import { createSkillMap } from "./skills/index.js";
import { parseWorkflow, workflowZ } from "./schema.js";
import { validateParsed } from "./loader.js";
import { formatReceipt, summarizeRun } from "./cli/run-output.js";
import { JOURNAL_FILE, RunJournal, journalDir, type JournalFaults, type JournalRecord } from "./journal.js";
import { prepareResume } from "./cli/resume.js";
import {
  DECIDER_DEFAULT_MAX_CALLS,
  DECIDER_MODE_REMOVED,
  DecideError,
  RunDecider,
  gateVerdict,
  hashDecisionInput,
  resolveThresholds,
  systemOneProvider,
  type ChoiceAsk,
} from "./decider.js";
import type { ExecutionTrace, Logger, Workflow } from "./types.js";

// Run keys go to a scratch state dir, never the real ~/.local/state.
process.env.SWENY_STATE_DIR = mkdtempSync(join(tmpdir(), "sweny-decider-state-"));

// ─── Fake /v1/systemone server (no Ollama, no TypeSafe, no model calls) ──

interface Seen {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}
type Reply = { status?: number; json?: unknown; raw?: string; hang?: boolean };

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
      res.end(r.raw ?? JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  servers.push(server);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl, seen };
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

// ─── systemOneProvider ──────────────────────────────────────────

describe("systemOneProvider", () => {
  it("posts the System One body and parses a choice answer", async () => {
    const srv = await fakeServer({
      json: choice("handle_high", { handle_high: 0.9, handle_low: 0.1 }, 0.9),
    });
    const p = systemOneProvider({ baseUrl: srv.baseUrl + "/", model: "nimble" });
    const out = await p.decide({ state: { a: 1 }, asks: { route: ASK } });
    expect(out.route).toEqual({
      kind: "choice",
      label: "handle_high",
      probabilities: { handle_high: 0.9, handle_low: 0.1 },
      confidence: 0.9,
    });
    expect(srv.seen).toHaveLength(1);
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
    [401, "unauthorized"],
    [403, "unauthorized"],
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

  it("times out", async () => {
    const srv = await fakeServer({ hang: true });
    const p = systemOneProvider({ baseUrl: srv.baseUrl, model: "m" });
    await expect(p.decide({ state: "s", asks: { route: ASK }, timeoutMs: 50 })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("reports a refused connection as network", async () => {
    const srv = await fakeServer({});
    const dead = srv.baseUrl;
    await new Promise<void>((ok) => servers.pop()!.close(() => ok()));
    const p = systemOneProvider({ baseUrl: dead, model: "m" });
    await expect(p.decide({ state: "s", asks: { route: ASK } })).rejects.toMatchObject({ code: "network" });
  });

  const good = { handle_high: 0.9, handle_low: 0.1 };
  it.each<[string, Reply, string]>([
    ["non-JSON body", { raw: "<html>" }, "malformed"],
    ["no answers", { json: { model: "m" } }, "malformed"],
    ["answers is an array", { json: { answers: [] } }, "malformed"],
    ["missing question", { json: { answers: {} } }, "malformed"],
    [
      "choice is not a string",
      { json: { answers: { route: { choice: 1, probabilities: good, confidence: 0.9 } } } },
      "malformed",
    ],
    ["confidence above 1", { json: choice("handle_high", good, 1.5) }, "malformed"],
    [
      "probability is negative",
      { json: choice("handle_high", { handle_high: 1.2, handle_low: -0.2 }, 0.9) },
      "malformed",
    ],
    [
      "probabilities missing",
      { json: { answers: { route: { choice: "handle_high", confidence: 0.9 } } } },
      "malformed",
    ],
    [
      "wrong answer type",
      { json: { answers: { route: { type: "score", choice: "handle_high", probabilities: good, confidence: 0.9 } } } },
      "malformed",
    ],
    ["label outside the criteria", { json: choice("rm_rf", { rm_rf: 0.95, handle_low: 0.05 }, 0.95) }, "unknown_label"],
    [
      "extra label in probabilities",
      { json: choice("handle_high", { handle_high: 0.9, other: 0.1 }, 0.9) },
      "unknown_label",
    ],
  ])("rejects a malformed response: %s", async (_name, reply, code) => {
    const srv = await fakeServer(reply);
    const p = systemOneProvider({ baseUrl: srv.baseUrl, model: "m" });
    const err = await p.decide({ state: "s", asks: { route: ASK } }).catch((e) => e);
    expect(err).toBeInstanceOf(DecideError);
    expect(err.code).toBe(code);
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

  it("accepts a confident, clear answer at the defaults (0.85, 0.2)", () => {
    expect(gateVerdict(v("a", { a: 0.9, b: 0.1 }, 0.85), edges)).toMatchObject({ accepted: true });
  });
  it("rejects low confidence", () => {
    expect(gateVerdict(v("a", { a: 0.9, b: 0.1 }, 0.84), edges)).toMatchObject({
      accepted: false,
      reason: "low_confidence",
    });
  });
  it("rejects a thin margin", () => {
    expect(gateVerdict(v("a", { a: 0.55, b: 0.45 }, 0.99), edges)).toMatchObject({
      accepted: false,
      reason: "low_margin",
    });
  });
  it("rejects a label outside the edge set, however confident", () => {
    expect(gateVerdict(v("z", { z: 1, a: 0 }, 1), edges)).toMatchObject({
      accepted: false,
      reason: "label_outside_edge_set",
    });
  });
  it("uses a workflow's stricter thresholds", () => {
    const t = resolveThresholds({ min_confidence: 0.95, min_margin: 0.5 });
    expect(gateVerdict(v("a", { a: 0.9, b: 0.1 }, 0.9), edges, t)).toMatchObject({ reason: "low_confidence" });
    expect(gateVerdict(v("a", { a: 0.7, b: 0.3 }, 0.99), edges, t)).toMatchObject({ reason: "low_margin" });
  });
  it("never goes looser than 0.7 / 0.1, even when a caller skips the schema", () => {
    expect(resolveThresholds({ min_confidence: 0.1, min_margin: 0 })).toEqual({ minConfidence: 0.7, minMargin: 0.1 });
    expect(resolveThresholds()).toEqual({ minConfidence: 0.85, minMargin: 0.2 });
  });
});

describe("hashDecisionInput", () => {
  it("is stable, short, and does not contain the input", () => {
    const h = hashDecisionInput({ secret: "tok-123" }, { a: "d" });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toBe(hashDecisionInput({ secret: "tok-123" }, { a: "d" }));
    expect(h).not.toBe(hashDecisionInput({ secret: "tok-124" }, { a: "d" }));
  });
});

// ─── Executor: the route ladder ─────────────────────────────────

const OUTPUT = {
  type: "object",
  properties: { severity: { type: "string" }, note: { type: "string" } },
};

function wf(decider?: Workflow["decider"], opts: { withDefault?: boolean; expressions?: boolean } = {}): Workflow {
  const edges: Workflow["edges"] = opts.expressions
    ? [
        { from: "check", to: "handle_high", when: { expr: "check.severity == 'high'" } },
        { from: "check", to: "handle_low", when: { expr: "check.severity != 'high'" } },
      ]
    : [
        { from: "check", to: "handle_high", when: "severity is high" },
        opts.withDefault
          ? { from: "check", to: "handle_low" }
          : { from: "check", to: "handle_low", when: "severity is low" },
      ];
  return {
    id: "decider-test",
    name: "Decider Test",
    description: "",
    entry: "check",
    ...(decider ? { decider } : {}),
    nodes: {
      check: { name: "Check", instruction: "SECRET-INSTRUCTION examine the alert", skills: [], output: OUTPUT },
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
  extra: { decider?: boolean; env?: NodeJS.ProcessEnv; logger?: Logger; input?: unknown } = {},
) {
  const claude = new MockClaude({
    workflow,
    responses: {
      check: { data: { severity: "high", note: `uses ${SECRET}`, extra: "UNDECLARED-DATA" } },
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
  }).then((r) => ({ ...r, evaluate }));
}

const cfg = (baseUrl: string, extra: Record<string, unknown> = {}): Workflow["decider"] => ({
  provider: { base_url: baseUrl, model: "nimble" },
  ...extra,
});
const providerCfg = (baseUrl: string, provider: Record<string, unknown>): Workflow["decider"] => ({
  provider: { base_url: baseUrl, model: "nimble", ...provider } as NonNullable<Workflow["decider"]>["provider"],
});

describe("the decider decides", () => {
  it("takes the decider's route when every gate passes, and never calls the agent", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    // The agent would have picked handle_high: the route proves who decided.
    const { results, trace, evaluate } = await runWith(wf(cfg(srv.baseUrl)), "handle_high");
    expect(results.has("handle_low")).toBe(true);
    expect(results.has("handle_high")).toBe(false);
    expect(evaluate).not.toHaveBeenCalled();
    expect(srv.seen).toHaveLength(1);
    expect(trace.edges[0]).toMatchObject({ from: "check", to: "handle_low", rung: "decider" });
    expect(trace.decisions).toHaveLength(1);
    expect(trace.decisions![0]).toMatchObject({
      node: "check",
      outcome: "decided",
      label: "handle_low",
      confidence: 0.95,
      model: "nimble",
    });
    expect(trace.decisions![0].margin).toBeCloseTo(0.92);
    expect(trace.decisions![0].input_hash).toMatch(/^[0-9a-f]{16}$/);
    // The unconditional edge after it decides nothing and carries no rung.
    expect(trace.edges[1]).toEqual({ from: "handle_low", to: "done", reason: "only path" });
  });

  it("may pick the default edge", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { results, evaluate, trace } = await runWith(wf(cfg(srv.baseUrl), { withDefault: true }), "handle_high");
    expect(results.has("handle_low")).toBe(true);
    expect(evaluate).not.toHaveBeenCalled();
    expect(srv.seen[0].body.questions.route.criteria).toEqual({
      handle_high: "severity is high",
      handle_low: "None of the above / default path",
    });
    expect(trace.edges[0].rung).toBe("decider");
  });

  it("honors the workflow's own thresholds", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { results, evaluate, trace } = await runWith(wf(cfg(srv.baseUrl, { min_confidence: 0.97 })), "handle_high");
    expect(results.has("handle_high")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(trace.decisions![0]).toMatchObject({ outcome: "fell_through", reason: "low_confidence" });
  });

  it("a below-floor threshold from a caller that skipped the schema is raised to the floor", async () => {
    const srv = await fakeServer({ json: choice("handle_low", { handle_high: 0.1, handle_low: 0.9 }, 0.65) });
    const { results, evaluate } = await runWith(wf(cfg(srv.baseUrl, { min_confidence: 0.5 })), "handle_high");
    expect(results.has("handle_high")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});

describe("every failure falls through to the agent", () => {
  const cases: Array<[string, Reply, string]> = [
    ["timeout", { hang: true }, "timeout"],
    ["401", { status: 401 }, "unauthorized"],
    ["403", { status: 403 }, "unauthorized"],
    ["422", { status: 422 }, "invalid_request"],
    ["429", { status: 429 }, "rate_limited"],
    ["500", { status: 500 }, "http_error"],
    ["503", { status: 503 }, "overloaded"],
    ["529", { status: 529 }, "overloaded"],
    ["malformed JSON", { raw: "nope" }, "malformed"],
    ["missing answers", { json: { model: "nimble" } }, "malformed"],
    ["low confidence", { json: choice("handle_low", { handle_high: 0.1, handle_low: 0.9 }, 0.6) }, "low_confidence"],
    ["low margin", { json: choice("handle_low", { handle_high: 0.45, handle_low: 0.55 }, 0.95) }, "low_margin"],
    ["label that is no edge", { json: choice("rm_rf", { rm_rf: 1, handle_low: 0 }, 0.99) }, "unknown_label"],
    [
      "label of a real node that is not an out-edge here",
      { json: choice("done", { done: 0.99, handle_low: 0.01 }, 0.99) },
      "unknown_label",
    ],
  ];
  it.each(cases)(
    "%s: the agent routes, the reason is recorded",
    async (_n, reply, reason) => {
      const srv = await fakeServer(reply);
      const t0 = Date.now();
      const { results, trace, evaluate } = await runWith(wf(cfg(srv.baseUrl)), "handle_high");
      // The 2 s per-call timeout bounds the wait.
      expect(Date.now() - t0).toBeLessThan((reply.hang ? 2000 : 0) + 3500);
      expect(results.has("handle_high")).toBe(true);
      expect(results.has("handle_low")).toBe(false);
      expect(results.has("done")).toBe(true);
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(trace.edges[0]).toMatchObject({ from: "check", to: "handle_high", rung: "agent" });
      expect(trace.decisions).toHaveLength(1);
      expect(trace.decisions![0]).toMatchObject({ outcome: "fell_through", reason });
    },
    10_000,
  );

  it("an unreachable provider: the agent routes", async () => {
    const { results, trace, evaluate } = await runWith(wf(cfg("http://127.0.0.1:1")), "handle_high");
    expect(results.has("handle_high")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(trace.decisions![0]).toMatchObject({ outcome: "fell_through", reason: "network" });
  });

  it("a fall-through keeps the agent's fail-closed rules: a failed agent eval takes the default edge", async () => {
    const srv = await fakeServer({ status: 500 });
    const { results, trace } = await runWith(wf(cfg(srv.baseUrl), { withDefault: true }), undefined);
    expect(results.has("handle_low")).toBe(true);
    expect(results.has("handle_high")).toBe(false);
    expect(trace.edges[0]).toMatchObject({ to: "handle_low", rung: "agent" });
  });
});

describe("expressions come first", () => {
  it("an expression node never asks the decider or the agent", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { results, trace, evaluate } = await runWith(wf(cfg(srv.baseUrl), { expressions: true }), "handle_low");
    expect(results.has("handle_high")).toBe(true);
    expect(srv.seen).toHaveLength(0);
    expect(evaluate).not.toHaveBeenCalled();
    expect(trace.edges[0]).toMatchObject({ to: "handle_high", rung: "expr" });
    expect(trace.decisions).toEqual([]);
  });
});

describe("turning it off", () => {
  it("no decider block: zero HTTP, the agent routes", async () => {
    const { results, trace, evaluate } = await runWith(wf(), "handle_high");
    expect(results.has("handle_high")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(trace.decisions).toBeUndefined();
    expect(trace.edges[0].rung).toBe("agent");
  });

  it("--no-decider (decider: false) skips a declared decider: zero HTTP", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { results, trace, evaluate } = await runWith(wf(cfg(srv.baseUrl)), "handle_high", { decider: false });
    expect(srv.seen).toHaveLength(0);
    expect(results.has("handle_high")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(trace.decisions).toBeUndefined();
  });

  it("sends the key named by api_key_env", async () => {
    const srv = await fakeServer({ json: confident("handle_high") });
    await runWith(wf(providerCfg(srv.baseUrl, { api_key_env: "DECIDER_KEY" })), "handle_high", {
      env: { DECIDER_KEY: "sk-test" },
    });
    expect(srv.seen[0].headers.authorization).toBe("Bearer sk-test");
  });

  it("a declared api_key_env that is unset disables the decider (no unauthenticated send)", async () => {
    const srv = await fakeServer({ json: confident("handle_low") });
    const { logger, warns } = capture();
    const { trace, results } = await runWith(wf(providerCfg(srv.baseUrl, { api_key_env: "NOPE" })), "handle_high", {
      logger,
    });
    expect(srv.seen).toHaveLength(0);
    expect(trace.decisions).toBeUndefined();
    expect(results.has("handle_high")).toBe(true);
    expect(warns.join("\n")).toContain("NOPE");
  });
});

describe("what the provider sees", () => {
  it("the fenced, redacted routing view: declared fields only, never input, env, instructions or undeclared data", async () => {
    const srv = await fakeServer({ json: confident("handle_high") });
    const { logger, lines } = capture();
    const { trace } = await runWith(wf(cfg(srv.baseUrl)), "handle_high", {
      logger,
      env: { MY_API_TOKEN: SECRET, HOME_DIR_PATH: "/home/runner-ENV-VALUE" },
      input: { ticket: "INPUT-DATA" },
    });
    const state = srv.seen[0].body.state;
    expect(typeof state).toBe("string");
    expect(state).toContain("<untrusted-data");
    expect(state).toContain('"severity": "high"');
    expect(state).toContain("[redacted]");
    expect(state).not.toContain(SECRET);
    expect(state).not.toContain("UNDECLARED-DATA");
    expect(state).not.toContain("SECRET-INSTRUCTION");
    expect(state).not.toContain("INPUT-DATA");
    expect(state).not.toContain("ENV-VALUE");
    expect(srv.seen[0].body.questions.route.criteria).toEqual({
      handle_high: "severity is high",
      handle_low: "severity is low",
    });

    // The decider's log lines and the trace hold metadata only.
    const deciderLines = lines.filter((l) => l.includes("decider"));
    expect(deciderLines.length).toBeGreaterThan(0);
    const logged = deciderLines.join("\n") + JSON.stringify(trace.decisions);
    expect(logged).toContain("route decider");
    expect(logged).not.toContain("UNDECLARED-DATA");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("severity is high");
    expect(Object.keys(trace.decisions![0]).sort()).toEqual(
      ["confidence", "input_hash", "label", "latency_ms", "margin", "model", "node", "outcome"].sort(),
    );
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

describe("circuit breaker", () => {
  it("after 3 consecutive failures it stops calling for the rest of the run, and says so once", async () => {
    const srv = await fakeServer({ status: 500 });
    const warns: string[] = [];
    const d = new RunDecider(systemOneProvider({ baseUrl: srv.baseUrl, model: "m" }), { warn: (m) => warns.push(m) });
    for (let i = 0; i < 6; i++) expect(await d.decide(Q())).toBeNull();
    expect(srv.seen).toHaveLength(3);
    expect(d.breakerOpen).toBe(true);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("3 failed calls in a row");
  });

  it("a good answer resets the count", async () => {
    let n = 0;
    const srv = await fakeServer(() => (++n === 3 ? { json: confident("handle_low") } : { status: 503 }));
    const d = new RunDecider(systemOneProvider({ baseUrl: srv.baseUrl, model: "m" }));
    const got = [];
    for (let i = 0; i < 5; i++) got.push(await d.decide(Q()));
    expect(got).toEqual([null, null, "handle_low", null, null]);
    expect(srv.seen).toHaveLength(5);
    expect(d.breakerOpen).toBe(false);
  });

  it("a low-confidence answer is not a provider failure", async () => {
    const srv = await fakeServer({ json: choice("handle_low", { handle_high: 0.4, handle_low: 0.6 }, 0.5) });
    const d = new RunDecider(systemOneProvider({ baseUrl: srv.baseUrl, model: "m" }));
    for (let i = 0; i < 5; i++) await d.decide(Q());
    expect(srv.seen).toHaveLength(5);
    expect(d.breakerOpen).toBe(false);
  });
});

describe("per-run call cap", () => {
  it("defaults to 200", () => {
    expect(DECIDER_DEFAULT_MAX_CALLS).toBe(200);
  });

  it("stops calling at the cap; the agent routes the rest", async () => {
    const srv = await fakeServer({ json: confident("handle_high") });
    const warns: string[] = [];
    const d = new RunDecider(systemOneProvider({ baseUrl: srv.baseUrl, model: "m" }), {
      maxCalls: 2,
      warn: (m) => warns.push(m),
    });
    const got = [];
    for (let i = 0; i < 4; i++) got.push(await d.decide(Q()));
    expect(got).toEqual(["handle_high", "handle_high", null, null]);
    expect(srv.seen).toHaveLength(2);
    expect(d.callCount).toBe(2);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("2-call cap");
  });
});

// ─── Journal and resume ─────────────────────────────────────────

const RUN_ID = "20261001-120000-dec357";

describe("journal and resume", () => {
  it("records the rung, and resume replays the decided route without calling the decider or the agent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sweny-decider-journal-"));
    dirs.push(cwd);
    const srv = await fakeServer({ json: confident("handle_low") });
    const workflow = wf(cfg(srv.baseUrl));

    // First attempt: the decider routes check -> handle_low, then the process dies before handle_low starts.
    const faults: JournalFaults = {
      beforeAppend(rec: JournalRecord) {
        if (rec.type === "node:start" && rec.node === "handle_low") throw new Error("killed");
      },
    };
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults });
    const first = new MockClaude({
      workflow,
      responses: { check: { data: { severity: "high", note: "n" } }, handle_high: {}, handle_low: {}, done: {} },
      routes: { check: "handle_high" },
    });
    const firstEval = vi.spyOn(first, "evaluate");
    await execute(
      workflow,
      {},
      { skills: createSkillMap([]), claude: first, config: {}, env: {}, logger: silent, journal },
    ).catch(() => undefined);
    expect(firstEval).not.toHaveBeenCalled();
    expect(srv.seen).toHaveLength(1);

    const records = readFileSync(join(journalDir(cwd, RUN_ID), JOURNAL_FILE), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(records.find((r) => r.type === "route")).toMatchObject({ from: "check", to: "handle_low", rung: "decider" });

    // Resume: check replays with its journaled route; neither the decider nor the agent is asked again.
    const prepared = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => workflow });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok || "planOnly" in prepared) return;
    const second = new MockClaude({
      workflow,
      responses: { check: { data: { severity: "high", note: "n" } }, handle_high: {}, handle_low: {}, done: {} },
      routes: { check: "handle_high" },
    });
    const secondEval = vi.spyOn(second, "evaluate");
    const { results, trace } = await execute(workflow, prepared.ctx.input, {
      skills: createSkillMap([]),
      claude: second,
      config: {},
      env: {},
      logger: silent,
      journal: prepared.ctx.journal,
    });
    prepared.ctx.journal.end("success");
    expect(srv.seen).toHaveLength(1);
    expect(secondEval).not.toHaveBeenCalled();
    expect(second.executedNodes).toEqual(["handle_low", "done"]);
    expect(results.has("handle_high")).toBe(false);
    expect(trace.edges[0]).toMatchObject({ from: "check", to: "handle_low", rung: "decider" });
  });
});

// ─── Receipt ────────────────────────────────────────────────────

describe("receipt segment", () => {
  const trace = (edges: ExecutionTrace["edges"], decisions: ExecutionTrace["decisions"]): ExecutionTrace => ({
    steps: [],
    edges,
    sources: {},
    ...(decisions ? { decisions } : {}),
  });
  const e = (rung?: "expr" | "decider" | "agent") => ({ from: "a", to: "b", reason: "r", ...(rung ? { rung } : {}) });

  it("prints `routes 5 (3 decider, 1 expr, 1 agent)`", () => {
    const t = trace([e("decider"), e("decider"), e("expr"), e(), e("decider"), e("agent")], []);
    const s = summarizeRun(new Map(), 1000, false, t);
    expect(s.routes).toEqual({ total: 5, decider: 3, expr: 1, agent: 1 });
    expect(formatReceipt(s)).toContain(" · routes 5 (3 decider, 1 expr, 1 agent)");
  });

  it("leaves out rungs that decided nothing", () => {
    const s = summarizeRun(new Map(), 1000, false, trace([e("agent"), e("agent")], []));
    expect(formatReceipt(s)).toContain(" · routes 2 (2 agent)");
  });

  it("prints nothing without a decider, and nothing with no conditional route", () => {
    expect(formatReceipt(summarizeRun(new Map(), 1000, false, trace([e("agent")], undefined)))).not.toContain("routes");
    expect(formatReceipt(summarizeRun(new Map(), 1000, false, trace([e()], [])))).not.toContain("routes");
  });

  it("no agreement metric survives", () => {
    const s = summarizeRun(new Map(), 1000, false, trace([e("decider")], []));
    expect(formatReceipt(s)).not.toMatch(/agreed|shadow/);
  });
});

// ─── Config and migration safety ────────────────────────────────

describe("decider config", () => {
  const base = {
    id: "w",
    name: "W",
    entry: "a",
    nodes: { a: { name: "A", instruction: "x", skills: [] } },
    edges: [],
  };
  const provider = { base_url: "http://localhost:11434", model: "nimble" };

  it("presence of a provider enables it; thresholds are optional", () => {
    expect(workflowZ.safeParse({ ...base, decider: { provider } }).success).toBe(true);
    expect(workflowZ.safeParse({ ...base, decider: { provider, min_confidence: 0.9, min_margin: 0.25 } }).success).toBe(
      true,
    );
  });

  it("refuses thresholds looser than 0.7 / 0.1", () => {
    expect(workflowZ.safeParse({ ...base, decider: { provider, min_confidence: 0.69 } }).success).toBe(false);
    expect(workflowZ.safeParse({ ...base, decider: { provider, min_margin: 0.09 } }).success).toBe(false);
  });

  it("refuses a provider fallback key", () => {
    expect(
      workflowZ.safeParse({ ...base, decider: { provider: { ...provider, fallback: "https://y" } } }).success,
    ).toBe(false);
  });

  it.each([
    ["shadow", { mode: "shadow", provider }],
    ["off", { mode: "off" }],
  ])("an old `mode: %s` config fails to load with an explanation, never silently decides", (_m, decider) => {
    const parsed = workflowZ.safeParse({ ...base, decider });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.message)).toContain(DECIDER_MODE_REMOVED);

    const loaded = validateParsed({ ...base, decider });
    expect(loaded.ok).toBe(false);
    const msg = !loaded.ok ? loaded.errors.map((x) => x.message).join("\n") : "";
    expect(msg).toContain("decider.mode: decider.mode was removed");
    expect(msg).toContain("shadow mode is gone");
    expect(msg).toContain("--no-decider");

    expect(() => parseWorkflow({ ...base, decider })).toThrow(/shadow mode is gone/);
  });
});
