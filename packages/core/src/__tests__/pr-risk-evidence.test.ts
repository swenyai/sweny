/**
 * pr-risk-review: sweny sets the risk level, the model only writes grounded notes.
 *
 * Dogfood runs 42903734226 and 42904138102 (PR #590, core 0.1.212): `assess`
 * rated the risk and wrote free-form reasons, and its judge failed about half
 * the first attempts because a reason claimed more than its quoted line
 * ("passes a repository secret" quoting the `uses:` line, "a new scheduled
 * workflow" quoting `pull-requests: write`). Now the level comes from `when`
 * expressions over the scope step's measurements (counts sweny recounts from
 * their lists), each level has its own comment node, and `assess` writes notes
 * `{ path, hunk, quote, observation }` whose observation (140 characters at
 * most) only restates its quoted line. The judge stays, judging only that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse } from "yaml";
import type { Claude, ExecutionEvent, NodeResult, Workflow } from "../types.js";
import { PACK_TEMPLATES } from "../cli/packs.js";
import { parseWorkflow, validateWorkflow } from "../schema.js";
import { PR_PATCH_CAPS, github } from "../skills/github.js";
import { resolveNodePermissions } from "../node-policy.js";
import { execute, isReadTool } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import { evaluateValueRule } from "../eval/value.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const WF_PATH = ".github/workflows/sweny-pr-risk-review.yml";
const USES_LINE = "      - uses: swenyai/sweny@v5";
const SECRET_LINE = "          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}";
const WF_HUNK = "@@ -20,6 +20,9 @@";
const WF_PATCH = [
  `${WF_HUNK} jobs:`,
  "   risk:",
  "     steps:",
  `+${USES_LINE}`,
  "+        with:",
  `+${SECRET_LINE}`,
].join("\n");
const BIG_PATH = "src/big.ts";
const SMALL = Array.from({ length: 8 }, (_, i) => `src/f${i}.ts`);

/** The PR's files as GitHub's /pulls/:n/files returns them. */
const PR_FILES = [
  { filename: WF_PATH, status: "added", additions: 3, deletions: 0, changes: 3, patch: WF_PATCH },
  { filename: "package-lock.json", status: "modified", additions: 4000, deletions: 900, changes: 4900 },
  {
    filename: BIG_PATH,
    status: "modified",
    additions: 400,
    deletions: 0,
    changes: 400,
    patch: `@@ -1,0 +1,400 @@\n${"+const x = 1;\n".repeat(1000)}`,
  },
  ...SMALL.map((f) => ({
    filename: f,
    status: "modified",
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: "@@ -1 +1 @@\n-a\n+b",
  })),
];

/** What the agent asks for: risky paths first, then the largest others (more than the cap). */
const ASKED = [WF_PATH, "package-lock.json", BIG_PATH, ...SMALL];

/** The two observations that restate their own quoted line. */
const GROUNDED = [
  {
    path: WF_PATH,
    hunk: WF_HUNK,
    quote: USES_LINE.trim(),
    observation: "Adds a step that uses swenyai/sweny at tag v5.",
  },
  {
    path: WF_PATH,
    hunk: WF_HUNK,
    quote: SECRET_LINE.trim(),
    observation: "Passes the CLAUDE_CODE_OAUTH_TOKEN secret as the claude-oauth-token input.",
  },
];
/** Run 42903734226's failure: the secret is on another line than the one quoted. */
const OVERCLAIM = { ...GROUNDED[0], observation: "Passes a repository secret to the action." };
const JUDGE_NO = `The note for ${WF_PATH} says it passes a repository secret; its quote is the uses: line.`;

const pack = parseWorkflow(parse(PACK_TEMPLATES.find((t) => t.id === "pr-risk-review")!.yaml)) as Workflow;

/**
 * An agent that reads the hunks through the real tool on every attempt and
 * answers with `first`, then with `retry` once the retry preamble is in front
 * of it. The judge says no to any observation claiming a repository secret.
 */
function agent(first: object[], retry: object[] = first) {
  const instructions: string[] = [];
  const judgePrompts: string[] = [];
  const toolOutputs: any[] = [];
  const claude: Claude = {
    async run(o): Promise<NodeResult> {
      instructions.push(o.instruction);
      const tool = o.tools.find((t) => t.name === "github_get_pr_patches")!;
      const input = { repo: "swenyai/sweny", number: 590, paths: ASKED };
      const output: any = await (tool.handler as (i: unknown) => Promise<unknown>)(input);
      toolOutputs.push(output);
      const not_read = [
        ...output.omitted.map((x: any) => ({ path: x.filename, why: x.reason })),
        ...output.files
          .filter((f: any) => f.truncated)
          .map((f: any) => ({ path: f.filename, why: "cut at the byte cap" })),
      ];
      return {
        status: "success",
        data: { notes: o.instruction.includes("## Retry guidance") ? retry : first, not_read },
        toolCalls: [{ tool: tool.name, input, output, status: "success" }],
      };
    },
    async evaluate(o) {
      return o.choices[0]!.id;
    },
    async ask(o) {
      judgePrompts.push(o.instruction);
      return o.instruction.includes("Passes a repository secret")
        ? `VERDICT: no\nREASONING: ${JUDGE_NO}`
        : "VERDICT: yes\nREASONING: Each observation restates its quoted line.";
    },
  };
  return { claude, instructions, judgePrompts, toolOutputs };
}

describe("pr-risk-review assess: grounded notes, rule gates first, one judged retry", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!String(url).includes("/pulls/590/files")) throw new Error(`unexpected fetch ${url}`);
        return new Response(JSON.stringify(PR_FILES), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function runAssess(claude: Claude, events: ExecutionEvent[] = []) {
    const workflow: Workflow = { ...pack, entry: "assess", nodes: { assess: pack.nodes.assess }, edges: [] };
    return execute(
      workflow,
      { repo: "swenyai/sweny", pr_number: 590 },
      {
        skills: createSkillMap([github]),
        claude,
        config: { GITHUB_TOKEN: "t" },
        logger: silent,
        observer: (e) => void events.push(e),
      },
    );
  }

  it("ships assess as a read-only note writer: patch tool only, no level, capped observations, judge kept", () => {
    const assess = pack.nodes.assess!;
    // Spec v2 (#598): a node with nothing declared is read-only, and a read
    // node keeps only `access: "read"` tools. The patch tool must survive that.
    expect(pack.spec_version).toBe("2");
    expect(assess.permissions).toBeUndefined();
    expect(resolveNodePermissions(assess, pack).access).toBe("read");
    expect(isReadTool(github.tools.find((t) => t.name === "github_get_pr_patches")!)).toBe(true);
    expect(assess.skills).toEqual(["github"]);
    expect(assess.tools?.allow).toEqual(["github_get_pr_patches"]);
    expect(assess.retry?.max).toBe(1);

    const out = assess.output as any;
    expect(Object.keys(out.properties)).toEqual(["notes", "not_read"]);
    expect(JSON.stringify(out)).not.toContain("risk_level");
    expect(out.properties.notes.maxItems).toBe(4);
    expect(Object.keys(out.properties.notes.items.properties)).toEqual(["path", "hunk", "quote", "observation"]);
    expect(out.properties.notes.items.properties.observation.maxLength).toBe(140);

    const names = (assess.eval ?? []).map((e) => e.name);
    expect(names).toEqual(["notes_shape", "read_the_hunks", "assess_is_read_only", "notes_are_grounded"]);
    const judge = (assess.eval ?? []).find((e) => e.kind === "judge")!;
    expect(judge.name).toBe("notes_are_grounded");
    expect(judge.rubric).toMatch(/against\s+its own quote/);
    // The instruction teaches with the live failures' patterns, good and bad.
    expect(assess.instruction).toContain('bad: "Passes a repository secret to the action."');
    expect(assess.instruction).toContain('bad: "A new scheduled workflow that runs unattended."');
  });

  it("grounded notes pass on the first attempt: one agent call, one judge call, no retry", async () => {
    const { claude, instructions, judgePrompts, toolOutputs } = agent(GROUNDED);
    const events: ExecutionEvent[] = [];
    const { results } = await runAssess(claude, events);
    const assess = results.get("assess")!;

    expect(instructions).toHaveLength(1);
    expect(judgePrompts).toHaveLength(1);
    expect(events.filter((e) => e.type === "node:retry")).toEqual([]);
    expect(assess.status).toBe("success");
    expect((assess.evals ?? []).filter((e) => !e.pass)).toEqual([]);

    // Every note cites a hunk the tool returned and a line inside it.
    const read = toolOutputs[0].files.find((f: any) => f.filename === WF_PATH);
    for (const note of (assess.data as any).notes) {
      const hunk = read.hunks.find((h: any) => h.header === note.hunk);
      expect(hunk, note.quote).toBeDefined();
      expect(hunk.text).toContain(note.quote);
    }
  });

  it("an over-claiming observation is rejected, and the retry that restates the line passes", async () => {
    const { claude, instructions, judgePrompts } = agent([OVERCLAIM, GROUNDED[1]], GROUNDED);
    const events: ExecutionEvent[] = [];
    const { results } = await runAssess(claude, events);
    const assess = results.get("assess")!;

    expect(instructions).toHaveLength(2);
    expect(instructions[0]).not.toContain("## Retry guidance");
    // The retry carries the pack's guidance, the judge's reasoning, then the step itself.
    expect(instructions[1]).toContain("## Retry guidance");
    expect(instructions[1]).toContain("rewrite its observation to say only");
    expect(instructions[1]).toContain(`notes_are_grounded (judge): ${JUDGE_NO}`);
    expect(instructions[1]).toContain("Write short, grounded notes on the changed lines");
    expect(events.filter((e) => e.type === "node:retry")).toEqual([
      expect.objectContaining({ type: "node:retry", node: "assess", attempt: 1 }),
    ]);
    expect(judgePrompts).toHaveLength(2);
    expect(judgePrompts[0]).toContain(OVERCLAIM.observation);
    expect(judgePrompts[1]).not.toContain(OVERCLAIM.observation);

    expect(assess.status).toBe("success");
    expect((assess.data as any).notes).toEqual(GROUNDED);
  });

  it("retries once only: an agent that keeps over-claiming fails the node on the judge", async () => {
    const { claude, instructions } = agent([OVERCLAIM]);
    const { results } = await runAssess(claude);
    const assess = results.get("assess")!;
    expect(instructions).toHaveLength(2);
    expect(assess.status).toBe("failed");
    expect(String((assess.data as any).error)).toContain("notes_are_grounded");
  });

  it("enforces the caps and reports every file it left out or cut", async () => {
    const { claude, toolOutputs } = agent(GROUNDED);
    const { results } = await runAssess(claude);
    const out = toolOutputs[0];

    expect(out.files.length).toBe(PR_PATCH_CAPS.maxFiles);
    expect(out.bytes).toBeLessThanOrEqual(PR_PATCH_CAPS.maxTotalBytes);
    for (const f of out.files) {
      const bytes = f.hunks.reduce((n: number, h: any) => n + new TextEncoder().encode(h.text).length, 0);
      expect(bytes, f.filename).toBeLessThanOrEqual(PR_PATCH_CAPS.maxBytesPerFile);
    }
    expect(out.truncated).toBe(true);
    expect(out.files.find((f: any) => f.filename === BIG_PATH)).toMatchObject({ truncated: true });

    const notRead = (results.get("assess")!.data as any).not_read;
    expect(notRead).toEqual(
      expect.arrayContaining([
        { path: "package-lock.json", why: "no patch from GitHub (binary file, or a diff too large for the API)" },
        { path: SMALL[6], why: `file cap (${PR_PATCH_CAPS.maxFiles} files)` },
        { path: SMALL[7], why: `file cap (${PR_PATCH_CAPS.maxFiles} files)` },
        { path: BIG_PATH, why: "cut at the byte cap" },
      ]),
    );
  });

  it("the rule gate rejects a bad hunk, quote or observation with no model call", () => {
    const shape = pack.nodes.assess!.eval!.find((e) => e.name === "notes_shape")!;
    expect(shape.kind).toBe("value");
    const check = (note: object) => evaluateValueRule(shape.rule!, { notes: [note], not_read: [] }).pass;
    expect(evaluateValueRule(shape.rule!, { notes: GROUNDED, not_read: [] }).pass).toBe(true);
    expect(evaluateValueRule(shape.rule!, { notes: [], not_read: [] }).pass).toBe(true);
    // Run 42904138102: the header copied with its section heading.
    for (const hunk of ["", "lines 20-28", WF_PATH, "@@ -25,7 +26,7 @@ PR=${1:?usage: land-pr.sh}"]) {
      expect(check({ ...GROUNDED[0], hunk }), hunk).toBe(false);
    }
    expect(check({ ...GROUNDED[0], quote: " " })).toBe(false);
    expect(check({ ...GROUNDED[0], quote: "with:\n  token: x" })).toBe(false);
    expect(check({ ...GROUNDED[0], observation: "" })).toBe(false);
    expect(check({ ...GROUNDED[0], observation: "x".repeat(141) })).toBe(false);
    expect(check({ ...GROUNDED[0], observation: "x".repeat(140) })).toBe(true);
    expect(check({ ...GROUNDED[0], observation: "Adds a step.\nIt also spends credits." })).toBe(false);
  });
});

// ─── The level ───────────────────────────────────────────────────────

type Scope = {
  size: "xs" | "s" | "m" | "l" | "xl";
  tests: number;
  risky: number;
  source?: boolean;
};

function scopeData(s: Scope, overrides: Record<string, unknown> = {}) {
  return {
    pr_number: 590,
    title: "t",
    files_changed: 3,
    additions: 10,
    deletions: 2,
    size: s.size,
    test_files: Array.from({ length: s.tests }, (_, i) => ({ path: `test/t${i}.test.ts` })),
    test_file_count: s.tests,
    source_touched: s.source ?? true,
    risky_area_count: s.risky,
    risky_areas: Array.from({ length: s.risky }, (_, i) => ({ path: `.github/workflows/w${i}.yml`, area: "ci-cd" })),
    ...overrides,
  };
}

/**
 * Run the whole pack with canned node data and no gates or skills. The fake
 * refuses every model route, so whichever comment node runs was picked by
 * sweny's expressions alone. `scope` answers from `scopes` in order.
 */
async function routeLevel(scopes: object[], assessData: object = { notes: [], not_read: [] }) {
  const wf = parseWorkflow(parse(PACK_TEMPLATES.find((t) => t.id === "pr-risk-review")!.yaml)) as Workflow;
  for (const n of Object.values(wf.nodes)) {
    n.skills = [];
    delete n.eval;
    delete n.tools;
    delete n.outputs;
  }
  const firstLine = (id: string) => String(wf.nodes[id]!.instruction).trim().split("\n")[0]!;
  const ran: string[] = [];
  const instructions: string[] = [];
  let scopeCalls = 0;
  const claude: Claude = {
    async run(o): Promise<NodeResult> {
      const id = Object.keys(wf.nodes).find((k) => o.instruction.includes(firstLine(k))) ?? "?";
      ran.push(id);
      instructions.push(o.instruction);
      const data =
        id === "scope"
          ? scopes[Math.min(scopeCalls++, scopes.length - 1)]
          : id === "assess"
            ? assessData
            : { requested: true, risk_level: id.replace("comment-", "") };
      return { status: "success", data: data as Record<string, unknown>, toolCalls: [] };
    },
    async evaluate() {
      throw new Error("the level must not be chosen by a model");
    },
    async ask() {
      throw new Error("no judge in a routing test");
    },
  };
  await execute(wf, {}, { skills: createSkillMap([]), claude, config: {}, logger: silent });
  return { ran, instructions };
}

describe("pr-risk-review level: sweny's rule, never the model's", () => {
  it("validates, routes assess on expressions over scope, and defaults to low", () => {
    expect(validateWorkflow(pack)).toEqual([]);
    const out = pack.edges.filter((e) => e.from === "assess");
    expect(out.map((e) => e.to)).toEqual(["comment-high", "comment-medium", "comment-low"]);
    for (const e of out.slice(0, 2)) expect((e.when as { expr: string }).expr).toMatch(/^[(]?scope\./);
    expect(out[2]!.when).toBeUndefined();
  });

  it("each comment node writes only its own level and is pinned to it by a rule", () => {
    for (const level of ["high", "medium", "low"]) {
      const node = pack.nodes[`comment-${level}`]!;
      expect(node.instruction).toContain(`"Risk: ${level} (size SIZE, N files)"`);
      const result = node.eval!.find((e) => e.name === "comment_result")!;
      expect(result.rule!.output_matches).toContainEqual({ path: "risk_level", equals: level });
      expect(node.outputs?.map((o) => [o.type, o.max])).toEqual([["comment", 1]]);
      expect(resolveNodePermissions(node, pack).access).toBe("read");
    }
    expect(pack.safe_outputs?.max).toBe(1);
  });

  const table: Array<[string, Scope, string]> = [
    ["risky area, no test", { size: "s", tests: 0, risky: 1 }, "high"],
    ["risky area, large, with tests", { size: "l", tests: 2, risky: 1 }, "high"],
    ["risky area, with tests", { size: "m", tests: 1, risky: 2 }, "medium"],
    ["no risky area, medium source change, no test", { size: "m", tests: 0, risky: 0 }, "medium"],
    ["no risky area, small source change, no test", { size: "s", tests: 0, risky: 0 }, "low"],
    ["no risky area, large change with tests", { size: "xl", tests: 3, risky: 0 }, "low"],
    ["docs only, large", { size: "l", tests: 0, risky: 0, source: false }, "low"],
  ];
  for (const [label, s, level] of table) {
    it(`${label}: ${level}`, async () => {
      const { ran } = await routeLevel([scopeData(s)]);
      expect(ran).toEqual(["scope", "assess", `comment-${level}`]);
    });
  }

  it("the model's own opinion of the level changes nothing", async () => {
    const { ran } = await routeLevel([scopeData({ size: "s", tests: 0, risky: 1 })], {
      notes: [],
      not_read: [],
      risk_level: "low",
    });
    expect(ran).toEqual(["scope", "assess", "comment-high"]);
  });

  it("a miscounted scope is caught by sweny's recount and repaired before the level is set", async () => {
    // Says no risky area while listing one: sweny recounts and asks again.
    const wrong = scopeData({ size: "s", tests: 0, risky: 1 }, { risky_area_count: 0 });
    const right = scopeData({ size: "s", tests: 0, risky: 1 });
    const { ran, instructions } = await routeLevel([wrong, right]);
    expect(ran).toEqual(["scope", "scope", "assess", "comment-high"]);
    expect(instructions[1]).toContain("risky_area_count");
    expect(instructions[1]).toContain("did not match this step's declared output schema");
  });
});
