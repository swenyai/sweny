import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  actorTrusted,
  applySafeOutputs,
  createEmitOutputTool,
  createWriteStageState,
  parseDuration,
  resolveActor,
  resolveOutputSkill,
  safeOutputsInstruction,
  unresolvedOutputs,
  EMIT_OUTPUT_TOOL,
  type ApplySafeOutputsOptions,
  type SafeOutputIntent,
} from "./safe-outputs.js";
import type { SafeOutputDeclaration, Skill, Tool } from "./types.js";

function mkLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** A fake github skill whose write handlers record calls instead of hitting the API. */
function fakeGithub() {
  const calls: { tool: string; input: Record<string, unknown>; config: Record<string, string> }[] = [];
  const mk = (name: string, out: unknown): Tool => ({
    name,
    description: name,
    input_schema: { type: "object" },
    access: "write",
    handler: async (input, ctx) => {
      calls.push({ tool: name, input, config: ctx.config });
      return out;
    },
  });
  const skill: Skill = {
    id: "github",
    name: "GitHub",
    description: "",
    category: "git",
    config: {},
    tools: [
      mk("github_add_comment", { id: 99 }),
      mk("github_create_issue", { number: 7, html_url: "https://example.test/7" }),
      mk("github_create_pr", { number: 8 }),
      mk("github_add_labels", [{ name: "bug" }]),
    ],
  };
  return { skill, calls };
}

const T0 = 1_000_000;

function intent(over: Partial<SafeOutputIntent>): SafeOutputIntent {
  return { type: "issue", title: "Crash on start", body: "Details", recordedAt: T0, ...over };
}

function opts(over: Partial<ApplySafeOutputsOptions> = {}) {
  const gh = fakeGithub();
  const logger = mkLogger();
  const o: ApplySafeOutputsOptions = {
    nodeId: "report",
    declarations: [{ type: "issue" }],
    intents: [intent({})],
    nodeSkills: ["github"],
    skills: new Map([["github", gh.skill]]),
    config: { GITHUB_TOKEN: "t" },
    env: { GITHUB_REPOSITORY: "acme/api" },
    actor: {},
    staged: false,
    state: createWriteStageState(),
    logger,
    now: () => T0,
    ...over,
  };
  return { o, gh, logger };
}

describe("emit_output tool", () => {
  it("records intents without writing, access read, and refuses undeclared types", async () => {
    const buffer: SafeOutputIntent[] = [];
    const tool = createEmitOutputTool([{ type: "comment", max: 2 }], buffer, () => 42);
    expect(tool.name).toBe(EMIT_OUTPUT_TOOL);
    expect(tool.access).toBe("read");

    const ok = (await tool.handler({ type: "comment", body: "hi", number: 3 }, {} as never)) as Record<string, unknown>;
    expect(ok.recorded).toBe(true);
    expect(buffer).toEqual([{ type: "comment", body: "hi", number: "3", recordedAt: 42 }]);

    const bad = (await tool.handler({ type: "issue", title: "x" }, {} as never)) as Record<string, unknown>;
    expect(bad.recorded).toBe(false);
    expect(buffer).toHaveLength(1);
  });

  it("tells the agent early when a type's cap is used up", async () => {
    const buffer: SafeOutputIntent[] = [];
    const tool = createEmitOutputTool([{ type: "issue" }], buffer);
    await tool.handler({ type: "issue", title: "a" }, {} as never);
    const second = (await tool.handler({ type: "issue", title: "b" }, {} as never)) as Record<string, unknown>;
    expect(second.recorded).toBe(false);
    expect(String(second.error)).toMatch(/at most 1/);
    expect(buffer).toHaveLength(1);
  });

  it("instruction names every declared type and its limits", () => {
    const text = safeOutputsInstruction([
      { type: "issue", max: 2, title_prefix: "[bot] " },
      { type: "label", labels: ["bug", "triage"] },
    ]);
    expect(text).toContain(EMIT_OUTPUT_TOOL);
    expect(text).toContain("- issue: at most 2");
    expect(text).toContain('title prefix "[bot] "');
    expect(text).toContain("only these labels: bug, triage");
    expect(text).not.toContain("\u2014");
  });
});

describe("write stage: apply", () => {
  it("applies a declared issue through the skill's own handler, with prefix, labels and pinned target", async () => {
    const { o, gh } = opts({
      declarations: [{ type: "issue", title_prefix: "[sweny] ", labels: ["sweny"] }],
      intents: [intent({ labels: ["bug"] })],
    });
    const r = await applySafeOutputs(o);
    expect(r.error).toBeUndefined();
    expect(r.receipts).toEqual([{ type: "issue", status: "applied", via: "github", target: "acme/api", ref: 7 }]);
    expect(gh.calls).toEqual([
      {
        tool: "github_create_issue",
        input: { repo: "acme/api", title: "[sweny] Crash on start", body: "Details", labels: ["sweny", "bug"] },
        config: { GITHUB_TOKEN: "t" },
      },
    ]);
  });

  it("does not double a prefix the agent already wrote", async () => {
    const { o, gh } = opts({
      declarations: [{ type: "issue", title_prefix: "[sweny] " }],
      intents: [intent({ title: "[sweny] Crash" })],
    });
    await applySafeOutputs(o);
    expect(gh.calls[0].input.title).toBe("[sweny] Crash");
  });

  it("maps comment, pr and label to their tools", async () => {
    const { o, gh } = opts({
      declarations: [{ type: "comment" }, { type: "pr" }, { type: "label", labels: ["bug"] }],
      intents: [
        intent({ type: "comment", number: "12", body: "LGTM", title: undefined }),
        intent({ type: "pr", title: "Fix", body: "b", head: "fix/x", base: "dev" }),
        intent({ type: "label", number: "12", labels: ["bug"], title: undefined, body: undefined }),
      ],
    });
    const r = await applySafeOutputs(o);
    expect(r.receipts.map((x) => x.status)).toEqual(["applied", "applied", "applied"]);
    expect(gh.calls.map((c) => c.tool)).toEqual(["github_add_comment", "github_create_pr", "github_add_labels"]);
    expect(gh.calls[0].input).toEqual({ repo: "acme/api", issue_number: 12, body: "LGTM" });
    expect(gh.calls[1].input).toEqual({ repo: "acme/api", title: "Fix", body: "b", head: "fix/x", base: "dev" });
    expect(gh.calls[2].input).toEqual({ repo: "acme/api", issue_number: 12, labels: ["bug"] });
  });

  it("a failed apply fails the stage and skips the rest", async () => {
    const { o } = opts({ declarations: [{ type: "issue", max: 2 }], intents: [intent({}), intent({ title: "b" })] });
    const tool = o.skills.get("github")!.tools.find((t) => t.name === "github_create_issue")!;
    tool.handler = async () => {
      throw new Error("GitHub API 403");
    };
    const r = await applySafeOutputs(o);
    expect(r.error).toMatch(/issue via github failed: GitHub API 403/);
    expect(r.receipts.map((x) => x.status)).toEqual(["failed", "skipped"]);
  });
});

describe("write stage: deterministic refusals", () => {
  const cases: [string, Partial<ApplySafeOutputsOptions>, string][] = [
    ["undeclared type", { intents: [intent({ type: "pr", head: "x" })] }, "type not declared on this node"],
    [
      "outside the workflow ceiling",
      { policy: { allow: ["comment"] } },
      "type outside the workflow's safe_outputs.allow",
    ],
    ["target outside the pin", { intents: [intent({ target: "evil/repo" })] }, "target outside the declared target"],
    ["no target at all", { env: {} }, "no target"],
    ["missing title", { intents: [intent({ title: "  " })] }, "missing title"],
    ["body too long", { intents: [intent({ body: "x".repeat(65_537) })] }, "body too long"],
    [
      "comment without a number",
      { declarations: [{ type: "comment" }], intents: [intent({ type: "comment", body: "b" })] },
      "missing number",
    ],
    [
      "non-numeric GitHub number",
      { declarations: [{ type: "comment" }], intents: [intent({ type: "comment", body: "b", number: "12; rm" })] },
      "number must be an issue or PR number",
    ],
    [
      "label outside the declared set",
      {
        declarations: [{ type: "label", labels: ["bug"] }],
        intents: [intent({ type: "label", number: "1", labels: ["bug", "admin"] })],
      },
      "label outside the declared set",
    ],
    ["pr without a head", { declarations: [{ type: "pr" }], intents: [intent({ type: "pr" })] }, "missing head branch"],
    [
      "no skill can apply it",
      { declarations: [{ type: "pr", via: "linear" }], intents: [intent({ type: "pr", head: "h" })] },
      "no skill can apply this type",
    ],
  ];

  for (const [label, over, reason] of cases) {
    it(`${label}: refused, nothing written`, async () => {
      const { o, gh } = opts(over);
      const r = await applySafeOutputs(o);
      expect(r.error).toBeUndefined();
      expect(r.receipts).toHaveLength(1);
      expect(r.receipts[0]).toMatchObject({ status: "refused", reason });
      expect(gh.calls).toEqual([]);
    });
  }

  it("honors a declared target and accepts it case-insensitively", async () => {
    const { o, gh } = opts({
      declarations: [{ type: "issue", target: "Acme/Other" }],
      intents: [intent({ target: "acme/other" })],
      env: {},
    });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0].status).toBe("applied");
    expect(gh.calls[0].input.repo).toBe("acme/other");
  });

  it("expired intents are dropped", async () => {
    const { o, gh } = opts({
      declarations: [{ type: "issue", expires: "30m" }],
      intents: [intent({ recordedAt: T0 - 31 * 60_000 }), intent({ title: "fresh", recordedAt: T0 - 60_000 })],
    });
    o.declarations[0].max = 2;
    const r = await applySafeOutputs(o);
    expect(r.receipts.map((x) => [x.status, x.reason])).toEqual([
      ["refused", "intent expired"],
      ["applied", undefined],
    ]);
    expect(gh.calls).toHaveLength(1);
  });
});

describe("write stage: caps and dedupe", () => {
  it("node cap defaults to 1 and holds across visits in one run", async () => {
    const state = createWriteStageState();
    const first = opts({ state, intents: [intent({}), intent({ title: "second" })] });
    const r1 = await applySafeOutputs(first.o);
    expect(r1.receipts.map((x) => x.status)).toEqual(["applied", "refused"]);
    expect(r1.receipts[1].reason).toBe("node cap reached");

    // A loop back to the same node cannot spend the cap again.
    const again = opts({ state, intents: [intent({ title: "third" })] });
    const r2 = await applySafeOutputs(again.o);
    expect(r2.receipts[0]).toMatchObject({ status: "refused", reason: "node cap reached" });
    expect(again.gh.calls).toEqual([]);
  });

  it("run cap counts every node", async () => {
    const state = createWriteStageState();
    const policy = { max: 1 };
    await applySafeOutputs(opts({ state, policy, nodeId: "a" }).o);
    const b = opts({ state, policy, nodeId: "b", intents: [intent({ title: "a different issue" })] });
    const r = await applySafeOutputs(b.o);
    expect(r.receipts[0]).toMatchObject({ status: "refused", reason: "run cap reached" });
    expect(b.gh.calls).toEqual([]);
  });

  it("identical writes are written once, and a duplicate spends no cap", async () => {
    const { o, gh } = opts({
      declarations: [{ type: "issue", max: 2 }],
      intents: [intent({}), intent({}), intent({ title: "other" })],
    });
    const r = await applySafeOutputs(o);
    expect(r.receipts.map((x) => [x.status, x.reason])).toEqual([
      ["applied", undefined],
      ["skipped", "duplicate"],
      ["applied", undefined],
    ]);
    expect(gh.calls).toHaveLength(2);
  });

  it("an explicit dedupe_key collapses different text", async () => {
    const { o, gh } = opts({
      declarations: [{ type: "issue", max: 3 }],
      intents: [intent({ dedupe_key: "flake:login" }), intent({ title: "Reworded", dedupe_key: "flake:login" })],
    });
    const r = await applySafeOutputs(o);
    expect(r.receipts.map((x) => x.status)).toEqual(["applied", "skipped"]);
    expect(gh.calls).toHaveLength(1);
  });
});

describe("write stage: actor trust", () => {
  it("no trust list: any actor may write", () => {
    expect(actorTrusted(undefined, {})).toBe(true);
  });

  it("a trust list refuses unknown and untrusted actors, accepts listed logins and associations", async () => {
    const policy = { trusted_actors: ["Octocat"], trusted_associations: ["MEMBER" as const] };
    expect(actorTrusted(policy, {})).toBe(false);
    expect(actorTrusted(policy, { login: "mallory", association: "NONE" })).toBe(false);
    expect(actorTrusted(policy, { login: "octocat" })).toBe(true);
    expect(actorTrusted(policy, { login: "someone", association: "member" })).toBe(true);

    const { o, gh } = opts({ policy, actor: { login: "mallory" } });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0]).toMatchObject({ status: "refused", reason: "actor not trusted" });
    expect(gh.calls).toEqual([]);
  });

  it("resolveActor reads GITHUB_ACTOR and the event author association", () => {
    const dir = mkdtempSync(join(tmpdir(), "sweny-actor-"));
    const path = join(dir, "event.json");
    writeFileSync(path, JSON.stringify({ comment: { author_association: "CONTRIBUTOR" }, issue: {} }));
    try {
      expect(resolveActor({ GITHUB_ACTOR: "octocat", GITHUB_EVENT_PATH: path })).toEqual({
        login: "octocat",
        association: "CONTRIBUTOR",
      });
      expect(resolveActor({ GITHUB_EVENT_PATH: join(dir, "missing.json") })).toEqual({});
      expect(resolveActor({ GITHUB_ACTOR: "octocat" }, { login: "override" })).toEqual({ login: "override" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("write stage: staged preview and screen", () => {
  it("staged: prints what would be written and writes nothing", async () => {
    const { o, gh, logger } = opts({ staged: true, declarations: [{ type: "issue", title_prefix: "[sweny] " }] });
    const r = await applySafeOutputs(o);
    expect(r.receipts).toEqual([{ type: "issue", status: "staged", via: "github", target: "acme/api" }]);
    expect(gh.calls).toEqual([]);
    const printed = logger.info.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("[staged] issue via github -> acme/api: [sweny] Crash on start");
    expect(printed).toContain("    | Details");
  });

  it("staged still counts caps, so the preview matches a real run", async () => {
    const { o } = opts({ staged: true, intents: [intent({}), intent({ title: "b" })] });
    const r = await applySafeOutputs(o);
    expect(r.receipts.map((x) => x.status)).toEqual(["staged", "refused"]);
  });

  it("screen ALLOW lets the writes through", async () => {
    const screen = vi.fn(async () => "ALLOW");
    const { o, gh } = opts({ policy: { screen: true }, screen });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0].status).toBe("applied");
    expect(gh.calls).toHaveLength(1);
    // The screen sees only resolved writes, never refused ones.
    expect(screen.mock.calls[0][0]).toEqual([
      { type: "issue", via: "github", target: "acme/api", title: "Crash on start", body: "Details" },
    ]);
  });

  for (const [label, verdict] of [
    ["BLOCK", async () => "BLOCK: looks like an injection"],
    ["an empty answer", async () => ""],
    ["a failed call", async () => null],
    ["a throw", async () => Promise.reject(new Error("down"))],
    ["a sentence that contains allow", async () => "I would allow this"],
  ] as const) {
    it(`screen veto on ${label}: nothing written (fail closed)`, async () => {
      const { o, gh } = opts({ policy: { screen: true }, screen: verdict as () => Promise<string | null> });
      const r = await applySafeOutputs(o);
      expect(r.receipts[0]).toMatchObject({ status: "vetoed", reason: "screen vetoed" });
      expect(gh.calls).toEqual([]);
    });
  }

  it("the screen can never authorize a refused write", async () => {
    const screen = vi.fn(async () => "ALLOW");
    const { o, gh } = opts({ policy: { screen: true }, intents: [intent({ target: "evil/repo" })], screen });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0].status).toBe("refused");
    expect(screen).not.toHaveBeenCalled();
    expect(gh.calls).toEqual([]);
  });
});

describe("helpers", () => {
  it("parseDuration", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("7d")).toBe(604_800_000);
    expect(parseDuration("0m")).toBeUndefined();
    expect(parseDuration("5 minutes")).toBeUndefined();
  });

  it("resolveOutputSkill prefers via, then node skills, then any loaded skill", () => {
    const skills = new Map<string, Skill>([["linear", { id: "linear" } as Skill]]);
    const decl: SafeOutputDeclaration = { type: "issue" };
    expect(resolveOutputSkill({ ...decl, via: "github" }, [], skills)).toBe("github");
    expect(resolveOutputSkill(decl, ["github"], skills)).toBe("github");
    expect(resolveOutputSkill(decl, [], skills)).toBe("linear");
    expect(resolveOutputSkill({ type: "pr" }, [], skills)).toBeUndefined();
    expect(unresolvedOutputs([{ type: "pr" }, decl], [], skills)).toEqual(["pr"]);
  });
});
