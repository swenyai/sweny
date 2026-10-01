// Property-based and adversarial tests for the safe-outputs write stage
// (safe-outputs.ts): caps hold for any request sequence, dedupe makes repeats
// apply once, a close only lands on the pinned issue, and staged mode never
// reaches an applier.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  applySafeOutputs,
  createWriteStageState,
  type ApplySafeOutputsOptions,
  type SafeOutputIntent,
} from "../../safe-outputs.js";
import type {
  Logger,
  SafeOutputDeclaration,
  SafeOutputPin,
  SafeOutputReceipt,
  SafeOutputState,
  SafeOutputType,
  Skill,
  Tool,
} from "../../types.js";
import { params } from "./config.js";

// ─── Fixtures ────────────────────────────────────────────────────

const T0 = 1_000_000;
const logger: Logger = { info() {}, warn() {}, error() {}, debug() {} };

const TYPES: SafeOutputType[] = ["comment", "issue", "pr", "label", "issue_state"];
const TOOL_FOR: Record<SafeOutputType, string> = {
  comment: "github_add_comment",
  issue: "github_create_issue",
  pr: "github_create_pr",
  label: "github_add_labels",
  issue_state: "github_set_issue_state",
};

interface Call {
  tool: string;
  input: Record<string, unknown>;
}

/** A github skill whose write handlers record calls instead of hitting the API. */
function fakeGithub(failOnCall?: number) {
  const calls: Call[] = [];
  const mk = (name: string, out: unknown): Tool => ({
    name,
    description: name,
    input_schema: { type: "object" },
    access: "write",
    handler: async (input) => {
      calls.push({ tool: name, input: input as Record<string, unknown> });
      if (failOnCall !== undefined && calls.length === failOnCall) throw new Error("boom");
      return out;
    },
  });
  const skill: Skill = {
    id: "github",
    name: "GitHub",
    description: "",
    category: "git",
    config: {},
    tools: Object.values(TOOL_FOR).map((n, i) => mk(n, { number: 100 + i })),
  };
  return { skill, calls };
}

function run(
  o: Partial<ApplySafeOutputsOptions> & Pick<ApplySafeOutputsOptions, "declarations" | "intents">,
  gh: ReturnType<typeof fakeGithub>,
) {
  return applySafeOutputs({
    nodeId: "n1",
    nodeSkills: ["github"],
    skills: new Map([["github", gh.skill]]),
    config: {},
    env: { GITHUB_REPOSITORY: "acme/api" },
    actor: {},
    staged: false,
    state: createWriteStageState(),
    logger,
    now: () => T0,
    ...o,
  });
}

// ─── Generators ──────────────────────────────────────────────────

const declFor = (type: SafeOutputType): fc.Arbitrary<SafeOutputDeclaration> =>
  fc
    .record({
      max: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
      target: fc.constantFrom<string | undefined>(undefined, "acme/api", "Acme/Other"),
      number: fc.constantFrom<SafeOutputPin | undefined>(undefined, "12", 12, { input: "issueNo" }),
      state: fc.constantFrom<SafeOutputState | undefined>(undefined, "close", "reopen"),
      labels: fc.constantFrom<string[] | undefined>(undefined, ["bug"], ["bug", "p1"]),
      title_prefix: fc.constantFrom<string | undefined>(undefined, "[bot] "),
    })
    .map((d): SafeOutputDeclaration => ({ type, ...d }));

const declsArb = fc.uniqueArray(fc.constantFrom(...TYPES).chain(declFor), { selector: (d) => d.type, maxLength: 5 });

const intentArb: fc.Arbitrary<SafeOutputIntent> = fc
  .record({
    type: fc.constantFrom<string>(...TYPES, "bogus"),
    title: fc.constantFrom<string | undefined>(undefined, "t", "u", "  "),
    body: fc.constantFrom<string | undefined>(undefined, "b", "c", "  "),
    target: fc.constantFrom<string | undefined>(undefined, "acme/api", "ACME/API", "evil/repo", "acme/other"),
    number: fc.constantFrom<string | undefined>(undefined, "12", "#12", "13", "abc", "0", "  12 "),
    labels: fc.constantFrom<string[] | undefined>(undefined, ["bug"], ["p1"], ["bug", "admin"]),
    head: fc.constantFrom<string | undefined>(undefined, "feat"),
    base: fc.constantFrom<string | undefined>(undefined, "main"),
    state: fc.constantFrom<string | undefined>(undefined, "close", "reopen", "bogus"),
    dedupe_key: fc.constantFrom<string | undefined>(undefined, "k1", "k2"),
  })
  .map((i): SafeOutputIntent => ({ ...i, recordedAt: T0 }));

const issueNoArb = fc.constantFrom<unknown>(undefined, 12, "12", "", "#12", "13", "abc", 0, -1, " 12 ");

const scenarioArb = fc.record({
  decls: fc.tuple(declsArb, declsArb),
  policyMax: fc.option(fc.integer({ min: 1, max: 6 }), { nil: undefined }),
  repoEnv: fc.boolean(),
  issueNo: issueNoArb,
  steps: fc.array(fc.record({ node: fc.constantFrom(0, 1), intents: fc.array(intentArb, { maxLength: 6 }) }), {
    maxLength: 6,
  }),
});

type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never;

async function playScenario(s: Scenario, staged: boolean) {
  const gh = fakeGithub();
  const state = createWriteStageState();
  const receipts: Array<{ node: number; receipt: SafeOutputReceipt }> = [];
  for (const step of s.steps) {
    const r = await applySafeOutputs({
      nodeId: `n${step.node}`,
      declarations: s.decls[step.node],
      intents: step.intents,
      policy: s.policyMax !== undefined ? { max: s.policyMax } : undefined,
      nodeSkills: ["github"],
      skills: new Map([["github", gh.skill]]),
      config: {},
      env: s.repoEnv ? { GITHUB_REPOSITORY: "acme/api" } : {},
      actor: {},
      staged,
      state,
      logger,
      input: { issueNo: s.issueNo },
      now: () => T0,
    });
    // One receipt per intent, always: nothing is dropped silently.
    expect(r.receipts).toHaveLength(step.intents.length);
    expect(r.error).toBeUndefined();
    for (const receipt of r.receipts) receipts.push({ node: step.node, receipt });
  }
  return { gh, state, receipts };
}

// ─── Properties ──────────────────────────────────────────────────

describe("safe outputs: caps hold for any request sequence", () => {
  it("applied writes never exceed a node's per-type cap or the run cap, across visits", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const { gh, state, receipts } = await playScenario(s, false);
        const applied = receipts.filter((r) => r.receipt.status === "applied");

        // Every applied receipt is a real call and every call is an applied receipt.
        expect(gh.calls).toHaveLength(applied.length);
        expect(state.total).toBe(applied.length);

        // Per node and type: within the declared cap (default 1), and the type was declared.
        for (const node of [0, 1]) {
          for (const type of TYPES) {
            const n = applied.filter((r) => r.node === node && r.receipt.type === type).length;
            const decl = s.decls[node].find((d) => d.type === type);
            if (!decl) expect(n).toBe(0);
            else expect(n).toBeLessThanOrEqual(decl.max ?? 1);
          }
        }
        // Run cap.
        if (s.policyMax !== undefined) expect(applied.length).toBeLessThanOrEqual(s.policyMax);

        // The tool called matches the type applied, in order.
        expect(gh.calls.map((c) => c.tool)).toEqual(applied.map((r) => TOOL_FOR[r.receipt.type as SafeOutputType]));
      }),
      params(200),
    );
  });

  it("a failing apply stops the stage: no call after it, no applied receipt after it, caps still hold", async () => {
    const valid: SafeOutputIntent[] = Array.from({ length: 8 }, (_, i) => ({
      type: i % 2 === 0 ? "comment" : "issue",
      title: `t${i}`,
      body: `body ${i}`,
      number: "5",
      recordedAt: T0,
    }));
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 4 }), async (failAt, runMax) => {
        const gh = fakeGithub(failAt);
        const r = await run(
          {
            declarations: [
              { type: "comment", max: 3 },
              { type: "issue", max: 3 },
            ],
            intents: valid,
            policy: { max: runMax },
          },
          gh,
        );
        expect(gh.calls.length).toBeLessThanOrEqual(Math.min(failAt, runMax));
        const failed = r.receipts.findIndex((x) => x.status === "failed");
        if (failed >= 0) {
          expect(r.error).toBeDefined();
          expect(r.receipts.slice(failed + 1).some((x) => x.status === "applied")).toBe(false);
        }
        expect(r.receipts).toHaveLength(valid.length);
      }),
      params(60),
    );
  });
});

describe("safe outputs: staged mode never calls an applier", () => {
  it("for any declarations and requests, staging writes nothing and reports nothing as applied", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const { gh, receipts } = await playScenario(s, true);
        expect(gh.calls).toEqual([]);
        expect(receipts.some((r) => r.receipt.status === "applied")).toBe(false);
      }),
      params(200),
    );
  });

  it("staged and applied runs accept exactly the same requests", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const staged = await playScenario(s, true);
        const applied = await playScenario(s, false);
        const view = (xs: typeof staged.receipts) =>
          xs.map((x) => [
            x.receipt.type,
            x.receipt.status === "staged" ? "ok" : x.receipt.status === "applied" ? "ok" : x.receipt.status,
            x.receipt.reason,
          ]);
        expect(view(staged.receipts)).toEqual(view(applied.receipts));
      }),
      params(100),
    );
  });
});

describe("safe outputs: dedupe makes repeated requests apply once", () => {
  const KINDS: Array<{ decl: SafeOutputDeclaration; intent: (body: string) => SafeOutputIntent }> = [
    {
      decl: { type: "comment", max: 100 },
      intent: (body) => ({ type: "comment", body, number: "5", recordedAt: T0 }),
    },
    {
      decl: { type: "issue", max: 100 },
      intent: (body) => ({ type: "issue", title: "T", body, recordedAt: T0 }),
    },
    {
      decl: { type: "pr", max: 100 },
      intent: (body) => ({ type: "pr", title: "T", body, head: "feat", recordedAt: T0 }),
    },
    {
      decl: { type: "label", max: 100 },
      intent: () => ({ type: "label", number: "5", labels: ["bug"], recordedAt: T0 }),
    },
    {
      decl: { type: "issue_state", max: 100, state: "close", number: 5 },
      intent: () => ({ type: "issue_state", state: "close", recordedAt: T0 }),
    },
  ];

  it("an identical request repeated, in one call or across several, is written once", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...KINDS),
        fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 4 }),
        async (kind, perCall) => {
          const gh = fakeGithub();
          const state = createWriteStageState();
          const receipts: SafeOutputReceipt[] = [];
          for (const n of perCall) {
            const r = await run(
              { declarations: [kind.decl], intents: Array.from({ length: n }, () => kind.intent("same")), state },
              gh,
            );
            receipts.push(...r.receipts);
          }
          expect(gh.calls).toHaveLength(1);
          expect(receipts.filter((r) => r.status === "applied")).toHaveLength(1);
          expect(receipts.filter((r) => r.status === "skipped" && r.reason === "duplicate")).toHaveLength(
            receipts.length - 1,
          );
        },
      ),
      params(100),
    );
  });

  it("requests sharing a dedupe_key and type are written once, whatever else differs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...KINDS),
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 2, maxLength: 5 }),
        async (kind, bodies) => {
          const gh = fakeGithub();
          const r = await run(
            {
              declarations: [kind.decl],
              intents: bodies.map((b) => ({ ...kind.intent(`x${b}`), dedupe_key: "same-key" })),
            },
            gh,
          );
          expect(gh.calls).toHaveLength(1);
          expect(r.receipts.filter((x) => x.status === "applied")).toHaveLength(1);
        },
      ),
      params(100),
    );
  });

  it("distinct requests are not collapsed: n different comments, issues or PRs are n writes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...KINDS.slice(0, 3)),
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 6 }),
        async (kind, bodies) => {
          const gh = fakeGithub();
          const r = await run({ declarations: [kind.decl], intents: bodies.map((b) => kind.intent(`x${b}`)) }, gh);
          expect(gh.calls).toHaveLength(bodies.length);
          expect(r.receipts.every((x) => x.status === "applied")).toBe(true);
        },
      ),
      params(100),
    );
  });
});

describe("safe outputs: a close only lands on the pinned issue", () => {
  /** Reference: the pin a declaration resolves to, written from the documented rules. */
  function pinOf(pin: SafeOutputPin | undefined, input: Record<string, unknown>): string | undefined {
    if (pin === undefined) return undefined;
    const raw = typeof pin === "object" ? input[pin.input] : pin;
    if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? String(raw) : undefined;
    if (typeof raw !== "string") return undefined;
    const v = raw.trim().replace(/^#/, "");
    return v.length > 0 ? v : undefined;
  }
  const norm = (x: string): string => x.trim().replace(/^#/, "").toLowerCase();

  const closeArb = fc.record({
    pin: fc.constantFrom<SafeOutputPin | undefined>(
      undefined,
      "12",
      12,
      "#12",
      "OFF-12",
      { input: "issueNo" },
      { input: "missing" },
    ),
    declState: fc.constantFrom<SafeOutputState | undefined>(undefined, "close", "reopen"),
    target: fc.constantFrom<string | undefined>(undefined, "acme/api", "Acme/Other"),
    envRepo: fc.constantFrom<string | undefined>(undefined, "acme/api"),
    issueNo: issueNoArb,
    intents: fc.array(
      fc.record({
        number: fc.constantFrom<string | undefined>(undefined, "12", "#12", "13", "abc", "012", " 12 "),
        state: fc.constantFrom<string | undefined>(undefined, "close", "reopen", "CLOSE", " close ", "delete"),
        target: fc.constantFrom<string | undefined>(undefined, "acme/api", "ACME/API", "evil/repo", "acme/other"),
      }),
      { minLength: 1, maxLength: 6 },
    ),
  });

  it("no close is applied without a declared pin, to another issue, or to another repo than the pinned one", async () => {
    await fc.assert(
      fc.asyncProperty(closeArb, async (s) => {
        const gh = fakeGithub();
        const input = { issueNo: s.issueNo };
        const decl: SafeOutputDeclaration = {
          type: "issue_state",
          max: 20,
          ...(s.pin !== undefined ? { number: s.pin } : {}),
          ...(s.declState ? { state: s.declState } : {}),
          ...(s.target ? { target: s.target } : {}),
        };
        const intents = s.intents.map((i): SafeOutputIntent => ({ type: "issue_state", ...i, recordedAt: T0 }));
        const r = await run(
          { declarations: [decl], intents, env: s.envRepo ? { GITHUB_REPOSITORY: s.envRepo } : {}, input },
          gh,
        );
        expect(r.error).toBeUndefined();

        const pin = pinOf(s.pin, input);
        const pinnedRepo = s.target ?? s.envRepo;
        for (const call of gh.calls) {
          expect(call.tool).toBe("github_set_issue_state");
          const n = call.input.issue_number as number;
          expect(Number.isInteger(n) && n > 0).toBe(true);
          if (call.input.state === "close") {
            // Close needs the declaration to pin the issue, and the state to allow it.
            expect(s.pin).toBeDefined();
            expect(pin).toBeDefined();
            // ...and the repo is the declared target or GITHUB_REPOSITORY, never the agent's own field.
            expect(pinnedRepo).toBeDefined();
            expect(String(call.input.repo).toLowerCase()).toBe(pinnedRepo!.toLowerCase());
            expect(s.declState === undefined || s.declState === "close").toBe(true);
          }
          // Any write on a pinned declaration lands on the pin, and nowhere else.
          if (pin !== undefined) expect(n).toBe(Number(pin));
          if (pinnedRepo) expect(String(call.input.repo).toLowerCase()).toBe(pinnedRepo.toLowerCase());
        }

        // Completeness: a request that satisfies every documented rule is applied.
        const pinValid = pin !== undefined && /^[1-9][0-9]*$/.test(pin);
        const acceptable = intents.some((i) => {
          if (!pinValid) return false;
          if (i.number !== undefined && norm(i.number) !== norm(pin!)) return false;
          if (i.target && pinnedRepo && i.target.toLowerCase() !== pinnedRepo.toLowerCase()) return false;
          if (!(i.target ?? pinnedRepo)) return false;
          const asked = i.state?.trim().toLowerCase() || s.declState;
          // A close never takes its repository from the intent.
          if (asked === "close" && !pinnedRepo) return false;
          if (asked !== "close" && asked !== "reopen") return false;
          if (s.declState && asked !== s.declState) return false;
          return true;
        });
        // (Only modeled for a pinned declaration; an unpinned `reopen` may name its own issue.)
        if (s.pin !== undefined) {
          if (acceptable) expect(gh.calls.length).toBeGreaterThanOrEqual(1);
          else expect(gh.calls).toEqual([]);
        }
      }),
      params(400),
    );
  });
});
