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
import { validateWorkflow } from "./schema.js";
import type { SafeOutputDeclaration, SafeOutputType, Skill, Tool, Workflow } from "./types.js";

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
      mk("github_set_issue_state", { number: 4, state: "open" }),
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
    expect(r.receipts).toEqual([
      { type: "issue", status: "applied", via: "github", target: "acme/api", ref: 7, url: "https://example.test/7" },
    ]);
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
    writeFileSync(
      path,
      JSON.stringify({ comment: { user: { login: "octocat" }, author_association: "CONTRIBUTOR" }, issue: {} }),
    );
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

describe("write stage: actor association provenance", () => {
  it.each([
    {
      name: "different author",
      event: { issue: { user: { login: "owner" }, author_association: "OWNER" } },
      login: "visitor",
    },
    { name: "missing author", event: { comment: { author_association: "MEMBER" } }, login: "visitor" },
    {
      name: "override differs from author",
      event: { review: { user: { login: "owner" }, author_association: "OWNER" } },
      login: "owner",
      override: { login: "visitor" },
    },
    { name: "no actor", event: { pull_request: { user: { login: "owner" }, author_association: "OWNER" } } },
    {
      name: "untrusted commenter with trusted issue author",
      event: {
        comment: { user: { login: "visitor" }, author_association: "NONE" },
        issue: { user: { login: "owner" }, author_association: "OWNER" },
      },
      login: "visitor",
    },
  ])("refuses writes for $name", async ({ event, login, override }) => {
    const dir = mkdtempSync(join(tmpdir(), "sweny-actor-"));
    const path = join(dir, "event.json");
    try {
      writeFileSync(path, JSON.stringify(event));
      const actor = resolveActor({ GITHUB_ACTOR: login, GITHUB_EVENT_PATH: path }, override);
      const { o, gh } = opts({ actor, policy: { trusted_associations: ["OWNER", "MEMBER"] } });
      expect((await applySafeOutputs(o)).receipts[0]).toMatchObject({ status: "refused", reason: "actor not trusted" });
      expect(gh.calls).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds only the matching author and preserves trusted explicit association overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "sweny-actor-"));
    const path = join(dir, "event.json");
    try {
      writeFileSync(
        path,
        JSON.stringify({
          comment: { user: { login: "other" }, author_association: "OWNER" },
          issue: { user: { login: "Octocat" }, author_association: "MEMBER" },
        }),
      );
      expect(resolveActor({ GITHUB_ACTOR: "octocat", GITHUB_EVENT_PATH: path })).toEqual({
        login: "octocat",
        association: "MEMBER",
      });
      expect(
        resolveActor(
          { GITHUB_ACTOR: "octocat", GITHUB_EVENT_PATH: path },
          { login: "explicit", association: "COLLABORATOR" },
        ),
      ).toEqual({ login: "explicit", association: "COLLABORATOR" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("write stage: Linear comment team pin", () => {
  function linearOptions(result: unknown, missing = false) {
    const read = vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    const write = vi.fn(async () => ({ id: "comment-id" }));
    const tool = (name: string, handler: Tool["handler"], access: "read" | "write"): Tool => ({
      name,
      handler,
      access,
      description: "",
      input_schema: { type: "object" },
    });
    const skill: Skill = {
      ...fakeGithub().skill,
      id: "linear",
      tools: [tool("linear_add_comment", write, "write"), ...(missing ? [] : [tool("linear_get_issue", read, "read")])],
    };
    const { o } = opts({
      declarations: [{ type: "comment", via: "linear", target: "team-a" }],
      intents: [intent({ type: "comment", number: "ABC-42" })],
      nodeSkills: ["linear"],
      skills: new Map([["linear", skill]]),
    });
    return { o, read, write };
  }

  it.each([
    { name: "another team", result: { issue: { id: "issue-id", team: { id: "team-b" } } } },
    { name: "missing team", result: { issue: { id: "issue-id", team: { key: "A" } } } },
    { name: "missing issue", result: { issue: null } },
    { name: "missing canonical ID", result: { issue: { team: { id: "team-a" } } } },
    { name: "lookup error", result: new Error("lookup failed") },
    { name: "unconfigured lookup", result: {}, missing: true },
  ])("refuses $name before any mutation or screen", async ({ result, missing }) => {
    const { o, write } = linearOptions(result, missing);
    const screen = vi.fn(async () => "ALLOW");
    o.policy = { screen: true };
    o.screen = screen;
    expect((await applySafeOutputs(o)).receipts[0]).toMatchObject({ status: "refused" });
    expect(write).not.toHaveBeenCalled();
    expect(screen).not.toHaveBeenCalled();
  });

  it("checks the actual team then writes the canonical issue ID", async () => {
    const { o, read, write } = linearOptions({ issue: { id: "immutable-issue-id", team: { id: "team-a" } } });
    expect((await applySafeOutputs(o)).receipts[0]).toMatchObject({ status: "applied", target: "team-a" });
    expect(read).toHaveBeenCalledWith({ id: "ABC-42" }, expect.objectContaining({ config: o.config }));
    expect(write).toHaveBeenCalledWith({ issueId: "immutable-issue-id", body: "Details" }, expect.anything());
    expect(read.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
  });

  it("staged comments still verify the pinned team without writing", async () => {
    const { o, read, write } = linearOptions({ issue: { id: "immutable-issue-id", team: { id: "team-a" } } });
    o.staged = true;
    expect((await applySafeOutputs(o)).receipts[0]).toMatchObject({ status: "staged" });
    expect(read).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
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
    const screen = vi.fn(async (_writes: Record<string, unknown>[]) => "ALLOW");
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

  it("resolveOutputSkill prefers a node skill that is configured", () => {
    const skills = new Map<string, Skill>([["github", { id: "github" } as Skill]]);
    expect(resolveOutputSkill({ type: "issue" }, ["linear", "github"], skills)).toBe("github");
    expect(resolveOutputSkill({ type: "comment" }, ["linear", "github"], new Map())).toBe("linear");
  });
});

function linearSkill(tools: Tool[]): Skill {
  return { id: "linear", name: "Linear", description: "", category: "tasks", config: {}, tools };
}

function writeTool(name: string, handler: Tool["handler"]): Tool {
  return { name, description: name, input_schema: { type: "object" }, access: "write", handler };
}

describe("write stage: issue pin (number)", () => {
  const comment = (number?: string) => intent({ type: "comment", body: "+1", ...(number ? { number } : {}) });

  it("a literal pin accepts that issue and fills a missing number", async () => {
    const { o, gh } = opts({
      declarations: [{ type: "comment", number: 12, max: 2 }],
      intents: [comment("#12"), comment()],
    });
    const r = await applySafeOutputs(o);
    // Same issue, same body: the second is a duplicate, not a second comment.
    expect(r.receipts.map((x) => x.status)).toEqual(["applied", "skipped"]);
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]).toMatchObject({
      tool: "github_add_comment",
      input: { repo: "acme/api", issue_number: 12, body: "+1" },
    });
  });

  it("refuses a comment on any other issue", async () => {
    const { o, gh } = opts({ declarations: [{ type: "comment", number: "12" }], intents: [comment("13")] });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0]).toMatchObject({ status: "refused", reason: "issue outside the declared number" });
    expect(gh.calls).toEqual([]);
  });

  it("an input pin reads the run input, and an empty input refuses", async () => {
    const pinned = opts({
      declarations: [{ type: "comment", number: { input: "pr_number" } }],
      intents: [comment()],
      input: { pr_number: 7 },
    });
    await applySafeOutputs(pinned.o);
    expect(pinned.gh.calls[0].input).toMatchObject({ issue_number: 7 });

    const empty = opts({
      declarations: [{ type: "comment", number: { input: "pr_number" } }],
      intents: [comment("7")],
      input: { pr_number: 0 },
    });
    const r = await applySafeOutputs(empty.o);
    expect(r.receipts[0]).toMatchObject({ status: "refused", reason: "pinned issue is not set for this run" });
    expect(empty.gh.calls).toEqual([]);
  });

  it("Linear identifiers match case-insensitively", async () => {
    const write = vi.fn(async () => ({ commentCreate: { success: true, comment: { id: "c-1" } } }));
    const { o } = opts({
      declarations: [{ type: "comment", via: "linear", number: { input: "issueIdentifier" } }],
      intents: [comment("off-12")],
      nodeSkills: ["linear"],
      skills: new Map([["linear", linearSkill([writeTool("linear_add_comment", write)])]]),
      input: { issueIdentifier: "OFF-12" },
    });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0]).toMatchObject({ status: "applied", ref: "c-1" });
    expect(write).toHaveBeenCalledWith({ issueId: "OFF-12", body: "+1" }, expect.anything());
  });

  it("the instruction names the pinned issue", () => {
    const text = safeOutputsInstruction([{ type: "comment", number: { input: "pr_number" } }], { pr_number: 5 });
    expect(text).toContain("only issue or PR 5");
  });
});

describe("write stage: receipts carry what the API produced", () => {
  it("reads the identifier and URL a Linear mutation wraps", async () => {
    const create = vi.fn(async () => ({
      issueCreate: {
        success: true,
        issue: { id: "uuid-1", identifier: "OFF-77", url: "https://linear.app/acme/issue/OFF-77", title: "t" },
      },
    }));
    const { o } = opts({
      declarations: [{ type: "issue", via: "linear", target: "team-a" }],
      nodeSkills: ["linear"],
      skills: new Map([["linear", linearSkill([writeTool("linear_create_issue", create)])]]),
    });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0]).toMatchObject({
      status: "applied",
      ref: "OFF-77",
      url: "https://linear.app/acme/issue/OFF-77",
    });
  });

  it("never records a GitHub API URL as the web URL", async () => {
    const gh = fakeGithub();
    gh.skill.tools = gh.skill.tools.map((t) =>
      t.name === "github_create_issue"
        ? { ...t, handler: async () => ({ number: 3, url: "https://api.github.com/repos/acme/api/issues/3" }) }
        : t,
    );
    const { o } = opts({ skills: new Map([["github", gh.skill]]) });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0].ref).toBe(3);
    expect(r.receipts[0].url).toBeUndefined();
  });
});

describe("write stage: issue_state", () => {
  const reopen = (over: Partial<SafeOutputIntent> = {}) => intent({ type: "issue_state", state: "reopen", ...over });
  const decl = (over: Partial<SafeOutputDeclaration> = {}): SafeOutputDeclaration[] => [
    { type: "issue_state", ...over },
  ];

  it("applies through github_set_issue_state with the pinned repo and number", async () => {
    const { o, gh } = opts({ declarations: decl({ number: 12 }), intents: [reopen({ number: "#12" })] });
    const r = await applySafeOutputs(o);
    expect(r.receipts).toEqual([
      expect.objectContaining({ type: "issue_state", status: "applied", via: "github", target: "acme/api" }),
    ]);
    expect(gh.calls).toEqual([
      expect.objectContaining({
        tool: "github_set_issue_state",
        input: { repo: "acme/api", issue_number: 12, state: "reopen" },
      }),
    ]);
  });

  it("a pin is required: no number and no declared pin is refused, nothing is written", async () => {
    const { o, gh } = opts({ declarations: decl(), intents: [reopen()] });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0]).toMatchObject({ status: "refused", reason: "missing number" });
    expect(gh.calls).toEqual([]);
  });

  it("a declared pin fills a missing number and refuses any other issue", async () => {
    const fills = opts({ declarations: decl({ number: 12 }), intents: [reopen()] });
    await applySafeOutputs(fills.o);
    expect(fills.gh.calls[0].input).toMatchObject({ issue_number: 12 });

    const other = opts({ declarations: decl({ number: 12 }), intents: [reopen({ number: "13" })] });
    const r = await applySafeOutputs(other.o);
    expect(r.receipts[0]).toMatchObject({ status: "refused", reason: "issue outside the declared number" });
    expect(other.gh.calls).toEqual([]);
  });

  it("an input pin reads the run input, and an empty input refuses", async () => {
    const set = opts({
      declarations: decl({ number: { input: "issue" } }),
      intents: [reopen()],
      input: { issue: 9 },
    });
    await applySafeOutputs(set.o);
    expect(set.gh.calls[0].input).toMatchObject({ issue_number: 9 });

    const empty = opts({ declarations: decl({ number: { input: "issue" } }), intents: [reopen()], input: {} });
    const r = await applySafeOutputs(empty.o);
    expect(r.receipts[0]).toMatchObject({ status: "refused", reason: "pinned issue is not set for this run" });
    expect(empty.gh.calls).toEqual([]);
  });

  it("the declared state limits the direction, and a missing or unknown state is refused", async () => {
    const cases: [Partial<SafeOutputIntent>, SafeOutputDeclaration[], string][] = [
      [{ state: "close", number: "5" }, decl({ state: "reopen" }), "state outside the declared state"],
      [{ state: "delete", number: "5" }, decl(), "state must be reopen or close"],
      [{ state: undefined, number: "5" }, decl(), "state must be reopen or close"],
    ];
    for (const [over, declarations, reason] of cases) {
      const { o, gh } = opts({ declarations, intents: [reopen(over)] });
      const r = await applySafeOutputs(o);
      expect(r.receipts[0]).toMatchObject({ status: "refused", reason });
      expect(gh.calls).toEqual([]);
    }
    // The declared state is the default when the agent omits it.
    const dflt = opts({ declarations: decl({ state: "close" }), intents: [reopen({ state: undefined, number: "5" })] });
    await applySafeOutputs(dflt.o);
    expect(dflt.gh.calls[0].input).toMatchObject({ state: "close" });
  });

  it("non-numeric GitHub numbers and other targets are refused", async () => {
    const bad = opts({ declarations: decl(), intents: [reopen({ number: "12; rm" })] });
    expect((await applySafeOutputs(bad.o)).receipts[0]).toMatchObject({
      reason: "number must be an issue or PR number",
    });
    const away = opts({ declarations: decl(), intents: [reopen({ number: "5", target: "evil/repo" })] });
    expect((await applySafeOutputs(away.o)).receipts[0]).toMatchObject({
      reason: "target outside the declared target",
    });
    expect(bad.gh.calls.concat(away.gh.calls)).toEqual([]);
  });

  it("caps: the node cap defaults to 1, max raises it, the run cap still applies", async () => {
    const two = [reopen({ number: "1" }), reopen({ number: "2" })];
    const one = opts({ declarations: decl(), intents: two });
    expect((await applySafeOutputs(one.o)).receipts.map((x) => x.reason)).toEqual([undefined, "node cap reached"]);

    const ten = opts({ declarations: decl({ max: 10 }), intents: two });
    expect((await applySafeOutputs(ten.o)).receipts.map((x) => x.status)).toEqual(["applied", "applied"]);

    const run = opts({ declarations: decl({ max: 10 }), intents: two, policy: { max: 1 } });
    expect((await applySafeOutputs(run.o)).receipts.map((x) => x.reason)).toEqual([undefined, "run cap reached"]);
  });

  it("dedupe: the same change twice is applied once, reopen and close on one issue are different writes", async () => {
    const { o, gh } = opts({
      declarations: decl({ max: 5 }),
      intents: [
        reopen({ number: "4" }),
        reopen({ number: "4" }),
        reopen({ number: "4", state: "close" }),
        reopen({ number: "4", dedupe_key: "k" }),
        reopen({ number: "5", dedupe_key: "k" }),
      ],
    });
    const r = await applySafeOutputs(o);
    expect(r.receipts.map((x) => [x.status, x.reason])).toEqual([
      ["applied", undefined],
      ["skipped", "duplicate"],
      ["applied", undefined],
      ["applied", undefined],
      ["skipped", "duplicate"],
    ]);
    expect(gh.calls.map((c) => c.input.state)).toEqual(["reopen", "close", "reopen"]);
  });

  it("staged: previews the state change and writes nothing", async () => {
    const { o, gh, logger } = opts({ staged: true, declarations: decl(), intents: [reopen({ number: "4" })] });
    const r = await applySafeOutputs(o);
    expect(r.receipts).toEqual([{ type: "issue_state", status: "staged", via: "github", target: "acme/api" }]);
    expect(gh.calls).toEqual([]);
    const printed = logger.info.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("[staged] issue_state via github -> acme/api#4");
    expect(printed).toContain("state: reopen");
  });

  it("receipts are metadata only: no state text, title or body", async () => {
    const { o } = opts({ declarations: decl(), intents: [reopen({ number: "4", body: "secret words" })] });
    const r = await applySafeOutputs(o);
    expect(JSON.stringify(r.receipts)).not.toContain("secret words");
    expect(Object.keys(r.receipts[0]).sort()).toEqual(["ref", "status", "target", "type", "via"]);
  });

  it("Linear: verifies the team, then calls linear_set_issue_state with the canonical id", async () => {
    const read = vi.fn(async () => ({ issue: { id: "uuid-1", team: { id: "team-a" } } }));
    const write = vi.fn(async () => ({
      issueUpdate: { success: true, issue: { id: "uuid-1", identifier: "OFF-4", url: "https://linear.app/x/OFF-4" } },
    }));
    const mk = (name: string, handler: Tool["handler"], access: "read" | "write"): Tool => ({
      name,
      handler,
      access,
      description: "",
      input_schema: { type: "object" },
    });
    const skill: Skill = {
      ...fakeGithub().skill,
      id: "linear",
      tools: [mk("linear_get_issue", read, "read"), mk("linear_set_issue_state", write, "write")],
    };
    const { o } = opts({
      declarations: decl({ via: "linear", target: "team-a", state: "reopen" }),
      intents: [reopen({ number: "OFF-4" })],
      nodeSkills: ["linear"],
      skills: new Map([["linear", skill]]),
    });
    const r = await applySafeOutputs(o);
    expect(r.receipts[0]).toMatchObject({ status: "applied", via: "linear", ref: "OFF-4" });
    expect(read).toHaveBeenCalledWith({ id: "OFF-4" }, expect.anything());
    expect(write).toHaveBeenCalledWith({ issueId: "uuid-1", state: "reopen" }, expect.anything());

    // Another team: refused, nothing written.
    write.mockClear();
    read.mockResolvedValueOnce({ issue: { id: "uuid-1", team: { id: "team-b" } } });
    const again = opts({
      declarations: decl({ via: "linear", target: "team-a" }),
      intents: [reopen({ number: "OFF-4" })],
      nodeSkills: ["linear"],
      skills: new Map([["linear", skill]]),
    });
    expect((await applySafeOutputs(again.o)).receipts[0]).toMatchObject({
      status: "refused",
      reason: "issue outside the declared team",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("emit_output accepts issue_state and records its state; the instruction names the direction", async () => {
    const buffer: SafeOutputIntent[] = [];
    const tool = createEmitOutputTool([{ type: "issue_state", state: "reopen", max: 2 }], buffer, () => T0);
    const r: any = await tool.handler({ type: "issue_state", state: "reopen", number: 4 }, {} as never);
    expect(r.recorded).toBe(true);
    expect(buffer[0]).toMatchObject({ type: "issue_state", state: "reopen", number: "4" });
    expect(safeOutputsInstruction([{ type: "issue_state", state: "reopen", number: 4 }])).toContain("only to reopen");
  });
});

describe("issue_state: workflow validation", () => {
  const wf = (outputs: SafeOutputDeclaration[], safe_outputs?: { allow: SafeOutputType[] }) =>
    ({
      id: "w",
      name: "W",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x", skills: ["github"], outputs } },
      edges: [],
      ...(safe_outputs ? { safe_outputs } : {}),
    }) as Workflow;

  it("accepts number and state on issue_state, and the ceiling applies to it", () => {
    expect(validateWorkflow(wf([{ type: "issue_state", state: "reopen", number: { input: "n" } }]))).toEqual([]);
    const codes = validateWorkflow(wf([{ type: "issue_state" }], { allow: ["comment"] })).map((e) => e.code);
    expect(codes).toEqual(["OUTPUT_NOT_ALLOWED"]);
  });

  it("rejects state on any other type, and via a skill that cannot apply it", () => {
    const codes = validateWorkflow(wf([{ type: "comment", state: "reopen" }])).map((e) => e.code);
    expect(codes).toEqual(["UNSUPPORTED_OUTPUT"]);
    const via = validateWorkflow(wf([{ type: "issue_state", via: "sentry" }])).map((e) => e.code);
    expect(via).toEqual(["UNSUPPORTED_OUTPUT"]);
  });
});
