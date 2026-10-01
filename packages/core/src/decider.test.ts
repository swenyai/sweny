import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { execute } from "./executor.js";
import { MockClaude } from "./testing.js";
import { createSkillMap } from "./skills/index.js";
import { workflowZ } from "./schema.js";
import { formatReceipt, summarizeRun } from "./cli/run-output.js";
import {
  DecideError,
  gateVerdict,
  hashDecisionInput,
  summarizeDecisions,
  systemOneProvider,
  type ChoiceAsk,
  type DecisionProvider,
} from "./decider.js";
import type { Logger, Workflow } from "./types.js";

// ─── Fake /v1/systemone server (no Ollama, no TypeSafe) ─────────

interface Seen {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}
type Reply = { status?: number; json?: unknown; raw?: string; hang?: boolean };

const servers: http.Server[] = [];

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
});

const choice = (label: string, probs: Record<string, number>, confidence: number) => ({
  model: "nimble",
  answers: { route: { type: "choice", choice: label, probabilities: probs, confidence } },
  usage: { input_tokens: 10, output_tokens: 2 },
});

const ASK: ChoiceAsk = {
  kind: "choice",
  instructions: "which?",
  criteria: { handle_high: "severity is high", handle_low: "default" },
};

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
    [529, "overloaded"],
    [500, "http_error"],
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
      "confidence is a string",
      { json: { answers: { route: { choice: "handle_high", probabilities: good, confidence: "0.9" } } } },
      "malformed",
    ],
    [
      "probability is negative",
      { json: choice("handle_high", { handle_high: 1.2, handle_low: -0.2 }, 0.9) },
      "malformed",
    ],
    [
      "probability is not a number",
      { json: { answers: { route: { choice: "handle_high", probabilities: { handle_high: "x" }, confidence: 0.9 } } } },
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

// ─── Gates ──────────────────────────────────────────────────────

describe("gateVerdict", () => {
  const edges = new Set(["a", "b"]);
  const v = (label: string, probabilities: Record<string, number>, confidence: number) => ({
    kind: "choice" as const,
    label,
    probabilities,
    confidence,
  });

  it("accepts a confident, clear answer", () => {
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
  it("rejects a label outside the edge set", () => {
    expect(gateVerdict(v("z", { z: 0.95, a: 0.05 }, 0.99), edges)).toMatchObject({
      accepted: false,
      reason: "label_outside_edge_set",
    });
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

// ─── Executor: shadow mode ──────────────────────────────────────

function wf(decider?: Workflow["decider"], withDefault = false): Workflow {
  return {
    id: "shadow-test",
    name: "Shadow Test",
    description: "",
    entry: "check",
    ...(decider ? { decider } : {}),
    nodes: {
      check: { name: "Check", instruction: "SECRET-INSTRUCTION examine the alert", skills: [] },
      handle_high: { name: "High", instruction: "handle high", skills: [] },
      handle_low: { name: "Low", instruction: "handle low", skills: [] },
    },
    edges: [
      { from: "check", to: "handle_high", when: "severity is high" },
      ...(withDefault
        ? [{ from: "check", to: "handle_low" }]
        : [{ from: "check", to: "handle_low", when: "severity is low" }]),
    ],
  };
}

function runWith(
  workflow: Workflow,
  route: string | undefined,
  extra: { decider?: "off" | "shadow"; env?: NodeJS.ProcessEnv; logger?: Logger } = {},
) {
  const claude = new MockClaude({
    workflow,
    responses: { check: { data: { severity: "high", note: "SECRET-DATA" } }, handle_high: {}, handle_low: {} },
    routes: route ? { check: route } : {},
  });
  return execute(
    workflow,
    {},
    {
      skills: createSkillMap([]),
      claude,
      config: {},
      env: extra.env ?? {},
      decider: extra.decider,
      logger: extra.logger,
    },
  );
}

const shadowCfg = (baseUrl: string, extra: Record<string, unknown> = {}): Workflow["decider"] => ({
  mode: "shadow",
  provider: { base_url: baseUrl, model: "nimble", ...extra },
});

describe("shadow mode in the executor", () => {
  it("logs agreement and routes with the agent", async () => {
    const srv = await fakeServer({ json: choice("handle_high", { handle_high: 0.93, handle_low: 0.07 }, 0.93) });
    const { results, trace } = await runWith(wf(shadowCfg(srv.baseUrl)), "handle_high");
    expect(results.has("handle_high")).toBe(true);
    expect(trace.edges[0]).toMatchObject({ from: "check", to: "handle_high" });
    expect(srv.seen).toHaveLength(1);
    expect(trace.decisions).toHaveLength(1);
    expect(trace.decisions![0]).toMatchObject({
      node: "check",
      decider_label: "handle_high",
      agent_label: "handle_high",
      confidence: 0.93,
      outcome: "compared",
      agree: true,
      model: "nimble",
    });
    expect(trace.decisions![0].margin).toBeCloseTo(0.86);
    expect(trace.decisions![0].latency_ms).toBeGreaterThanOrEqual(0);
    expect(trace.decisions![0].input_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("a confident disagreement never changes the route", async () => {
    const srv = await fakeServer({ json: choice("handle_low", { handle_high: 0.02, handle_low: 0.98 }, 0.97) });
    const { results, trace } = await runWith(wf(shadowCfg(srv.baseUrl)), "handle_high");
    expect(results.has("handle_high")).toBe(true);
    expect(results.has("handle_low")).toBe(false);
    expect(trace.decisions![0]).toMatchObject({ outcome: "compared", agree: false, decider_label: "handle_low" });
  });

  it("sends the routing view to the configured provider, and logs none of it", async () => {
    const srv = await fakeServer({ json: choice("handle_high", { handle_high: 0.9, handle_low: 0.1 }, 0.9) });
    const lines: string[] = [];
    const logger: Logger = {
      info: (m, d) => lines.push(m + JSON.stringify(d ?? {})),
      warn: (m, d) => lines.push(m + JSON.stringify(d ?? {})),
      error: (m, d) => lines.push(m + JSON.stringify(d ?? {})),
      debug: (m, d) => lines.push(m + JSON.stringify(d ?? {})),
    };
    const { trace } = await runWith(wf(shadowCfg(srv.baseUrl)), "handle_high", { logger });
    expect(srv.seen[0].body.questions.route.criteria).toEqual({
      handle_high: "severity is high",
      handle_low: "severity is low",
    });
    const deciderLines = lines.filter((l) => l.includes("decider"));
    expect(deciderLines.length).toBeGreaterThan(0);
    const logged = deciderLines.join("\n") + JSON.stringify(trace.decisions);
    expect(logged).toContain("decider (shadow)");
    expect(logged).not.toContain("SECRET-DATA");
    expect(logged).not.toContain("SECRET-INSTRUCTION");
    expect(logged).not.toContain("severity is high");
    expect(Object.keys(trace.decisions![0]).sort()).toEqual(
      [
        "agent_label",
        "agree",
        "confidence",
        "decider_label",
        "input_hash",
        "latency_ms",
        "margin",
        "model",
        "node",
        "outcome",
      ].sort(),
    );
  });

  it("sends the key named by api_key_env", async () => {
    const srv = await fakeServer({ json: choice("handle_high", { handle_high: 0.9, handle_low: 0.1 }, 0.9) });
    await runWith(wf(shadowCfg(srv.baseUrl, { api_key_env: "DECIDER_KEY" })), "handle_high", {
      env: { DECIDER_KEY: "sk-test" },
    });
    expect(srv.seen[0].headers.authorization).toBe("Bearer sk-test");
  });

  const fallThroughs: Array<[string, Reply, string]> = [
    ["timeout", { hang: true }, "timeout"],
    ["401", { status: 401 }, "unauthorized"],
    ["422", { status: 422 }, "invalid_request"],
    ["429", { status: 429 }, "rate_limited"],
    ["529", { status: 529 }, "overloaded"],
    ["malformed JSON", { raw: "nope" }, "malformed"],
    ["low confidence", { json: choice("handle_low", { handle_high: 0.1, handle_low: 0.9 }, 0.6) }, "low_confidence"],
    ["low margin", { json: choice("handle_low", { handle_high: 0.45, handle_low: 0.55 }, 0.95) }, "low_margin"],
    ["label outside the edge set", { json: choice("rm_rf", { rm_rf: 1, handle_low: 0 }, 0.99) }, "unknown_label"],
  ];
  it.each(fallThroughs)(
    "%s falls through, logs the reason, and leaves the route alone",
    async (_n, reply, reason) => {
      const srv = await fakeServer(reply);
      const slow = reply.hang ? 2500 : 0;
      const t0 = Date.now();
      const { results, trace } = await runWith(wf(shadowCfg(srv.baseUrl)), "handle_high");
      expect(Date.now() - t0).toBeLessThan(slow + 3500);
      expect(results.has("handle_high")).toBe(true);
      expect(results.has("handle_low")).toBe(false);
      expect(trace.decisions).toHaveLength(1);
      expect(trace.decisions![0]).toMatchObject({ outcome: "fell_through", reason, agree: null });
    },
    10_000,
  );

  it("an unreachable provider changes nothing", async () => {
    const { results, trace } = await runWith(wf(shadowCfg("http://127.0.0.1:1")), "handle_high");
    expect(results.has("handle_high")).toBe(true);
    expect(trace.decisions![0]).toMatchObject({ outcome: "fell_through", reason: "network" });
  });

  it("when the agent fails and the default edge is taken, the decider cannot override it", async () => {
    const srv = await fakeServer({ json: choice("handle_high", { handle_high: 0.99, handle_low: 0.01 }, 0.99) });
    const { results, trace } = await runWith(wf(shadowCfg(srv.baseUrl), true), undefined);
    expect(results.has("handle_low")).toBe(true);
    expect(results.has("handle_high")).toBe(false);
    expect(trace.decisions![0]).toMatchObject({ outcome: "fell_through", reason: "agent_failed", agent_label: null });
  });

  it("off mode makes zero HTTP calls", async () => {
    const srv = await fakeServer({ json: choice("handle_high", { handle_high: 0.9, handle_low: 0.1 }, 0.9) });
    const off = await runWith(wf({ mode: "off", provider: { base_url: srv.baseUrl, model: "nimble" } }), "handle_high");
    expect(off.trace.decisions).toBeUndefined();
    const none = await runWith(wf(), "handle_high");
    expect(none.trace.decisions).toBeUndefined();
    const forcedOff = await runWith(wf(shadowCfg(srv.baseUrl)), "handle_high", { decider: "off" });
    expect(forcedOff.trace.decisions).toBeUndefined();
    expect(srv.seen).toHaveLength(0);
  });

  it("--decider shadow turns on a configured provider", async () => {
    const srv = await fakeServer({ json: choice("handle_high", { handle_high: 0.9, handle_low: 0.1 }, 0.9) });
    const { trace } = await runWith(
      wf({ mode: "off", provider: { base_url: srv.baseUrl, model: "nimble" } }),
      "handle_high",
      { decider: "shadow" },
    );
    expect(srv.seen).toHaveLength(1);
    expect(trace.decisions).toHaveLength(1);
  });

  it("never invents a provider: shadow without one makes no call and still routes", async () => {
    const warns: string[] = [];
    const logger: Logger = { info() {}, error() {}, debug() {}, warn: (m) => warns.push(m) };
    const { results, trace } = await runWith(wf({ mode: "shadow" }), "handle_high", { logger });
    expect(results.has("handle_high")).toBe(true);
    expect(trace.decisions).toBeUndefined();
    expect(warns.join("\n")).toContain("decider.provider");
  });

  it("a declared api_key_env that is unset disables the decider (no unauthenticated send)", async () => {
    const srv = await fakeServer({});
    const { trace } = await runWith(wf(shadowCfg(srv.baseUrl, { api_key_env: "NOPE" })), "handle_high");
    expect(srv.seen).toHaveLength(0);
    expect(trace.decisions).toBeUndefined();
  });
});

// ─── Receipt, summary, config ───────────────────────────────────

describe("receipt segment", () => {
  const rec = (agree: boolean | null, outcome: "compared" | "fell_through") => ({
    node: "n",
    decider_label: "a",
    agent_label: "a",
    confidence: 0.9,
    margin: 0.5,
    outcome,
    agree,
    latency_ms: 3,
    model: "m",
    input_hash: "0".repeat(16),
  });

  it("summarizes agreement and fall-throughs", () => {
    const d = [rec(true, "compared"), rec(false, "compared"), rec(null, "fell_through")];
    expect(summarizeDecisions(d)).toEqual({ compared: 2, agreed: 1, fell_through: 1 });
  });

  it("prints `decider agreed 4/5`", () => {
    const decisions = [
      ...Array.from({ length: 4 }, () => rec(true, "compared")),
      rec(false, "compared"),
      rec(null, "fell_through"),
    ];
    const s = summarizeRun(new Map(), 1000, false, { steps: [], edges: [], sources: {}, decisions });
    expect(formatReceipt(s)).toContain("· decider agreed 4/5");
  });

  it("prints nothing when the decider was off", () => {
    const s = summarizeRun(new Map(), 1000, false, { steps: [], edges: [], sources: {} });
    expect(formatReceipt(s)).not.toContain("decider");
  });
});

describe("decider config schema", () => {
  const base = {
    id: "w",
    name: "W",
    entry: "a",
    nodes: { a: { name: "A", instruction: "x", skills: [] } },
    edges: [],
  };
  it("accepts off and shadow with a provider", () => {
    expect(workflowZ.safeParse({ ...base, decider: { mode: "off" } }).success).toBe(true);
    expect(
      workflowZ.safeParse({
        ...base,
        decider: { mode: "shadow", provider: { base_url: "http://localhost:11434", model: "nimble" } },
      }).success,
    ).toBe(true);
  });
  it("rejects shadow without a provider, live mode, and unknown keys", () => {
    expect(workflowZ.safeParse({ ...base, decider: { mode: "shadow" } }).success).toBe(false);
    expect(workflowZ.safeParse({ ...base, decider: { mode: "live" } }).success).toBe(false);
    expect(
      workflowZ.safeParse({
        ...base,
        decider: { mode: "shadow", provider: { base_url: "http://x", model: "m", fallback: "https://y" } },
      }).success,
    ).toBe(false);
  });
});

// A provider double proves the executor depends only on the interface.
describe("DecisionProvider interface", () => {
  it("accepts any provider implementation", () => {
    const p: DecisionProvider = {
      id: "fake",
      model: "m",
      async decide() {
        return {};
      },
    };
    expect(p.id).toBe("fake");
  });
});
