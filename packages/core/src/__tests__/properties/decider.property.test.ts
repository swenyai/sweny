// Property-based tests for the decision-model rung (#357): an answer can only
// ever route to one of the node's own edges (prototype-named labels included),
// a below-threshold answer never routes, thresholds never go below the floors,
// the circuit breaker follows its model, and the call cap is a hard bound.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  DecideError,
  RunDecider,
  gateVerdict,
  parseAnswers,
  resolveThresholds,
  type DecisionProvider,
} from "../../decider.js";
import { params } from "./config.js";

const PROTO = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "prototype"];
const labelArb = fc.oneof(fc.constantFrom(...PROTO), fc.string({ minLength: 1, maxLength: 8 }));
const keysArb = fc.uniqueArray(labelArb, { minLength: 1, maxLength: 5 });
const probArb = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.constantFrom(-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY),
);

/** An object with own keys only (Object.fromEntries never touches the prototype). */
const own = (entries: unknown[][]): Record<string, any> => Object.fromEntries(entries as Array<[string, unknown]>);

describe("decider: parse never returns a label outside the criteria", () => {
  it("holds for arbitrary answers, prototype-named labels included", () => {
    fc.assert(
      fc.property(
        keysArb,
        fc.uniqueArray(labelArb, { maxLength: 6 }),
        labelArb,
        fc.array(probArb, { minLength: 6, maxLength: 6 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (criteriaKeys, probKeys, chosen, probs, confidence) => {
          const criteria = own(criteriaKeys.map((k) => [k, `cond ${k}`])) as Record<string, string>;
          const probabilities = own(probKeys.map((k, i) => [k, probs[i]]));
          const body = { answers: own([["route", { choice: chosen, probabilities, confidence }]]) };
          let out;
          try {
            out = parseAnswers(body, { route: { kind: "choice", instructions: "q", criteria } });
          } catch (e) {
            expect(e).toBeInstanceOf(DecideError);
            return;
          }
          const v = out.route;
          expect(criteriaKeys).toContain(v.label);
          expect(Object.keys(v.probabilities).sort()).toEqual([...criteriaKeys].sort());
          const total = Object.values(v.probabilities).reduce((a, b) => a + b, 0);
          expect(Math.abs(total - 1)).toBeLessThanOrEqual(0.01 + 1e-12);
          for (const [k, p] of Object.entries(v.probabilities))
            if (k !== v.label) expect(p).toBeLessThan(v.probabilities[v.label]);
        },
      ),
      params(),
    );
  });

  it("a well-formed answer naming one of the criteria parses, whatever the label's name", () => {
    fc.assert(
      fc.property(keysArb, fc.nat(), (keys, pick) => {
        const label = keys[pick % keys.length];
        const rest = keys.length - 1;
        const probabilities = own(keys.map((k) => [k, k === label ? (rest === 0 ? 1 : 0.9) : 0.1 / rest]));
        const criteria = own(keys.map((k) => [k, "c"])) as Record<string, string>;
        const out = parseAnswers(
          { answers: own([["route", { choice: label, probabilities, confidence: 0.9 }]]) },
          { route: { kind: "choice", instructions: "q", criteria } },
        );
        expect(out.route.label).toBe(label);
      }),
      params(),
    );
  });
});

describe("decider: gates", () => {
  const verdictArb = fc.record({
    label: labelArb,
    others: fc.dictionary(labelArb, fc.double({ min: 0, max: 1, noNaN: true }), { maxKeys: 4 }),
    top: fc.double({ min: 0, max: 1, noNaN: true }),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  });

  it("never accepts a label outside the edge set, and never accepts below the thresholds", () => {
    fc.assert(
      fc.property(
        verdictArb,
        keysArb,
        fc.double({ min: -1, max: 2, noNaN: true }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        (v, edges, minConfidence, minMargin) => {
          const probabilities = own([...Object.entries(v.others).filter(([k]) => k !== v.label), [v.label, v.top]]);
          const t = resolveThresholds({ min_confidence: minConfidence, min_margin: minMargin });
          const edgeSet = new Set(edges);
          const g = gateVerdict(
            { kind: "choice", label: v.label, probabilities, confidence: v.confidence },
            edgeSet,
            t,
          );
          if (!g.accepted) return;
          expect(edgeSet.has(v.label)).toBe(true);
          expect(v.confidence).toBeGreaterThanOrEqual(t.minConfidence - 1e-9);
          expect(g.margin).toBeGreaterThanOrEqual(t.minMargin - 1e-9);
        },
      ),
      params(),
    );
  });

  it("thresholds are always clamped to [floor, 1]", () => {
    const anyNum = fc.oneof(fc.double(), fc.constantFrom(Number.NaN, -Infinity, Infinity, undefined));
    fc.assert(
      fc.property(anyNum, anyNum, (c, m) => {
        const t = resolveThresholds({ min_confidence: c, min_margin: m });
        expect(t.minConfidence).toBeGreaterThanOrEqual(0.7);
        expect(t.minConfidence).toBeLessThanOrEqual(1);
        expect(t.minMargin).toBeGreaterThanOrEqual(0.1);
        expect(t.minMargin).toBeLessThanOrEqual(1);
        const d = new RunDecider(
          { id: "f", model: "m", decide: async () => ({}) },
          {
            config: { min_confidence: c, min_margin: m },
          },
        );
        expect(d.thresholds).toEqual(t);
      }),
      params(),
    );
  });
});

type Outcome = "fail" | "abort" | "low" | "ok";

function provider(script: Outcome[]) {
  let calls = 0;
  const p: DecisionProvider = {
    id: "fake",
    model: "m",
    async decide() {
      const s = script[calls++] ?? "ok";
      if (s === "fail") throw new DecideError("network", "request failed");
      if (s === "abort") throw new DecideError("aborted", "request aborted");
      return {
        route: {
          kind: "choice",
          label: "a",
          probabilities: own([
            ["a", 0.9],
            ["b", 0.1],
          ]),
          confidence: s === "low" ? 0.5 : 0.95,
        },
      };
    },
  };
  return { p, calls: () => calls };
}

const Q = {
  node: "n",
  question: "q",
  state: "s",
  choices: [
    { id: "a", description: "a" },
    { id: "b", description: "b" },
  ],
};

describe("decider: breaker and cap", () => {
  it("the breaker follows its model: 3 consecutive non-abort failures open it for good", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<Outcome>("fail", "abort", "low", "ok"), { maxLength: 30 }),
        async (script) => {
          const { p, calls } = provider(script);
          const d = new RunDecider(p);
          // Model.
          let made = 0;
          let failures = 0;
          let open = false;
          for (let i = 0; i < script.length; i++) {
            const want = !open ? script[made] : undefined;
            const got = await d.decide(Q);
            if (open) {
              expect(got).toBeNull();
              continue;
            }
            made++;
            if (want === "fail") failures++;
            else if (want === "low" || want === "ok") failures = 0;
            if (failures >= 3) open = true;
            expect(got).toBe(want === "ok" ? "a" : null);
          }
          expect(calls()).toBe(made);
          expect(d.counters).toEqual({ calls: made, failures, open });
        },
      ),
      params(),
    );
  });

  it("maxCalls is a hard bound on provider calls", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 15 }), fc.integer({ min: 0, max: 30 }), async (maxCalls, n) => {
        const { p, calls } = provider([]);
        const d = new RunDecider(p, { maxCalls });
        for (let i = 0; i < n; i++) await d.decide(Q);
        expect(calls()).toBe(Math.min(n, maxCalls));
      }),
      params(),
    );
  });
});
