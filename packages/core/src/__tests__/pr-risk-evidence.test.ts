/**
 * pr-risk-review reasons rest on the changed lines, not on file names.
 *
 * Dogfood runs 42898455544 and 42898705880 (PR #590, core 0.1.210): `assess`
 * saw only the file list and line counts, so it inferred behavior from file
 * names ("uses a repo secret", "spends model credits") and its
 * `reasons_are_grounded` judge failed the run. Now `assess` reads the patch
 * hunks of the riskiest files through `github_get_pr_patches` (hard caps,
 * every omission named), cites path + hunk header + quoted line for every
 * reason, and gets one retry with the judge's reasoning when a check fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse } from "yaml";
import type { Claude, ExecutionEvent, NodeResult, Workflow } from "../types.js";
import { PACK_TEMPLATES } from "../cli/packs.js";
import { parseWorkflow } from "../schema.js";
import { PR_PATCH_CAPS } from "../skills/github.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const WF_PATH = ".github/workflows/sweny-pr-risk-review.yml";
const SECRET_LINE = "          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}";
const WF_HUNK = "@@ -20,6 +20,9 @@";
const WF_PATCH = [
  `${WF_HUNK} jobs:`,
  "   risk:",
  "     steps:",
  "+      - uses: swenyai/sweny@v5",
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

const UNGROUNDED = {
  reason: "Runs on every pull request and spends model credits",
  path: WF_PATH,
  hunk: WF_HUNK,
  quote: "- uses: swenyai/sweny@v5",
};
const GROUNDED = {
  reason: "The new step passes a repository secret to the action",
  path: WF_PATH,
  hunk: WF_HUNK,
  quote: SECRET_LINE.trim(),
};
const JUDGE_NO = `The reason for ${WF_PATH} claims it spends model credits; its quote does not show that.`;

/**
 * An agent that reads the hunks through the real tool every attempt, then
 * answers with an ungrounded reason until the retry preamble is in front of
 * it (never, when `stubborn`). The judge says no to a reason about credits.
 */
function agent(opts: { stubborn?: boolean } = {}) {
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
      const retried = o.instruction.includes("## Retry guidance");
      const not_read = [
        ...output.omitted.map((x: any) => ({ path: x.filename, why: x.reason })),
        ...output.files
          .filter((f: any) => f.truncated)
          .map((f: any) => ({ path: f.filename, why: "cut at the byte cap" })),
      ];
      return {
        status: "success",
        data: {
          risk_level: "high",
          test_gap: true,
          reasons: [retried && !opts.stubborn ? GROUNDED : UNGROUNDED],
          not_read,
          focus: [`secret handling in ${WF_PATH}`],
        },
        toolCalls: [{ tool: tool.name, input, output, status: "success" }],
      };
    },
    async evaluate(o) {
      return o.choices[0]!.id;
    },
    async ask(o) {
      judgePrompts.push(o.instruction);
      return o.instruction.includes("model credits")
        ? `VERDICT: no\nREASONING: ${JUDGE_NO}`
        : "VERDICT: yes\nREASONING: Each reason says what its quoted line shows.";
    },
  };
  return { claude, instructions, judgePrompts, toolOutputs };
}

const pack = parseWorkflow(parse(PACK_TEMPLATES.find((t) => t.id === "pr-risk-review")!.yaml)) as Workflow;

describe("pr-risk-review assess: bounded hunks, cited reasons, one judged retry", () => {
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
    const { execute } = await import("../executor.js");
    const { createSkillMap, github } = await import("../skills/index.js");
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

  it("ships assess with only the read-only patch tool, one retry, and the judge still in place", () => {
    const assess = pack.nodes.assess!;
    expect(assess.skills).toEqual(["github"]);
    expect(assess.tools?.allow).toEqual(["github_get_pr_patches"]);
    expect(assess.retry?.max).toBe(1);
    const judge = (assess.eval ?? []).find((e) => e.name === "reasons_are_grounded");
    expect(judge?.kind).toBe("judge");
    expect(judge?.rubric).toMatch(/does not show/);
    const names = (assess.eval ?? []).map((e) => e.name);
    expect(names).toEqual(["assess_shape", "read_the_hunks", "assess_is_read_only", "reasons_are_grounded"]);
  });

  it("an ungrounded reason fails the judge, and the retry with a cited hunk passes", async () => {
    const { claude, instructions, judgePrompts, toolOutputs } = agent();
    const events: ExecutionEvent[] = [];
    const { results } = await runAssess(claude, events);
    const assess = results.get("assess")!;

    expect(instructions).toHaveLength(2);
    expect(instructions[0]).not.toContain("## Retry guidance");
    // The retry carries the pack's guidance, the judge's reasoning, then the step itself.
    expect(instructions[1]).toContain("## Retry guidance");
    expect(instructions[1]).toContain("Call github_get_pr_patches again with the same paths.");
    expect(instructions[1]).toContain(`reasons_are_grounded (judge): ${JUDGE_NO}`);
    expect(instructions[1]).toContain("Rate how carefully a reviewer should look at this PR");
    expect(events.filter((e) => e.type === "node:retry")).toEqual([
      expect.objectContaining({ type: "node:retry", node: "assess", attempt: 1 }),
    ]);

    expect(judgePrompts).toHaveLength(2);
    expect(judgePrompts[1]).toContain(JSON.stringify(GROUNDED.quote));

    expect(assess.status).toBe("success");
    expect((assess.evals ?? []).filter((e) => !e.pass)).toEqual([]);
    const reason = (assess.data as any).reasons[0];
    expect(reason).toEqual(GROUNDED);

    // The cited hunk and quoted line are what the tool returned for that file.
    const read = toolOutputs[1].files.find((f: any) => f.filename === WF_PATH);
    const hunk = read.hunks.find((h: any) => h.header === reason.hunk);
    expect(hunk).toBeDefined();
    expect(hunk.text).toContain(reason.quote);
  });

  it("enforces the caps and reports every file it left out or cut", async () => {
    const { claude, toolOutputs } = agent();
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

  it("retries once only: an agent that stays ungrounded fails the node on the judge", async () => {
    const { claude, instructions } = agent({ stubborn: true });
    const { results } = await runAssess(claude);
    const assess = results.get("assess")!;
    expect(instructions).toHaveLength(2);
    expect(assess.status).toBe("failed");
    expect(String((assess.data as any).error)).toContain("reasons_are_grounded");
  });

  it("a reason without a hunk header fails the value gate before any judging matters", async () => {
    const { evaluateValueRule } = await import("../eval/value.js");
    const shape = pack.nodes.assess!.eval!.find((e) => e.name === "assess_shape")!;
    const base = { risk_level: "low", test_gap: false, not_read: [], focus: [] };
    expect(evaluateValueRule(shape.rule!, { ...base, reasons: [GROUNDED] }).pass).toBe(true);
    expect(evaluateValueRule(shape.rule!, { ...base, reasons: [] }).pass).toBe(true);
    for (const hunk of ["", "lines 20-28", ".github/workflows/x.yml", "@@ -20,6 +20,9 @@ jobs:"]) {
      expect(evaluateValueRule(shape.rule!, { ...base, reasons: [{ ...GROUNDED, hunk }] }).pass, hunk).toBe(false);
    }
    expect(evaluateValueRule(shape.rule!, { ...base, reasons: [{ ...GROUNDED, quote: " " }] }).pass).toBe(false);
  });
});
