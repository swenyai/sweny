/**
 * #363: crash boundaries for the run journal and `sweny workflow resume`.
 *
 * Each spec kills a run at one boundary, then resumes it through the same path
 * the CLI uses (`prepareResume` + `execute` with the resume journal). A kill is
 * simulated with the journal's fault seam: the append that would have happened
 * next throws, and nothing after it reaches the disk, so the file on disk is
 * exactly what a killed process leaves. The agent is a fake (no model calls).
 *
 * Every spec asserts the two things a resume must get right: no node's agent
 * runs again unless its result never reached the journal, and no write is
 * applied twice.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import {
  JOURNAL_FILE,
  JournalMismatchError,
  NODE_RESULT_JOURNAL,
  RunJournal,
  checkRecordSequence,
  journalDir,
  journalResult,
  markerToken,
  readJournal,
  type JournalFaults,
  type JournalRecord,
} from "../journal.js";
import { prepareResume, type ResumeOptions } from "../cli/resume.js";
import { createWriteStageState } from "../safe-outputs.js";
import type { Claude, NodeResult, NodeUsage, Skill, ToolContext, Workflow } from "../types.js";

// Every spec writes real journals: the journal fsyncs each append and each
// atomic replace (that is what makes a crash boundary real), so the only work
// here that is not plain CPU is file I/O on a shared runner. Measured in CI
// (hosted ubuntu-26.04, Node 22 and 24): the whole file, 41 to 46 specs, takes
// 1.2 to 1.8s on a quiet runner (about 40ms a spec) and 3.4 to 4.9s on a loaded
// one. One spec has stalled past the 5s default ("crash before a node starts",
// Node 24, file total 6.6s), the other 34 in that run finished in ~1.5s total,
// so it is a stall, not a slow spec. Budget: 30s = 16x the quiet cost of the
// entire file (so far above any single spec) and 6x the stall seen. A real
// regression (a quadratic read, an unbounded retry) is far past it.
vi.setConfig({ testTimeout: 30_000 });

// Run keys go to a scratch state dir, never the real ~/.local/state.
process.env.SWENY_STATE_DIR = mkdtempSync(join(tmpdir(), "sweny-state-"));

const RUN_ID = "20260930-120000-abc123";
const silent = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * A pid that no process has: above Linux's pid_max (2^22) and macOS's (99999),
 * so `kill(pid, 0)` is ESRCH and the lock reads as stale. Stands in for a
 * killed run's pid without spawning a real child process (a synchronous node
 * start per kill, on a loaded runner, was the only non-journal cost in these specs).
 */
const DEAD_PID = 2 ** 31 - 1;

class Kill extends Error {
  constructor(at: string) {
    super(`killed at ${at}`);
    this.name = "Kill";
  }
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "sweny-journal-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Kill when the journal is about to append a record of `type` (for `node`, when given). */
function killAt(type: string, node?: string): JournalFaults {
  return {
    beforeAppend(rec: JournalRecord) {
      if (rec.type === type && (node === undefined || rec.node === node)) throw new Kill(`${type} ${node ?? ""}`);
    },
  };
}

/** A fake agent: records which node it ran, requests the scripted writes, returns `<node>-out`. */
function fakeAgent(
  opts: {
    kill?: (node: string, nth: number) => boolean;
    emit?: Record<string, object[]>;
    data?: (node: string, nth: number) => Record<string, unknown> | undefined;
    /** Usage on the node's final result. */
    usage?: (node: string, nth: number) => NodeUsage | undefined;
    /** Usage reported live through `onUsage`, before anything else (and before a kill). */
    live?: (node: string, nth: number) => NodeUsage | undefined;
    /** Whether the agent ran inside an enforced sandbox (default: yes). */
    contained?: (node: string) => boolean;
  } = {},
) {
  const calls: string[] = [];
  const claude: Claude = {
    async run(req) {
      const node = /NODE:(\w+)/.exec(req.instruction)![1];
      calls.push(node);
      const live = opts.live?.(node, calls.filter((c) => c === node).length);
      if (live) req.onUsage?.(live);
      if (opts.kill?.(node, calls.filter((c) => c === node).length)) throw new Kill(`agent ${node}`);
      const emitter = req.tools.find((t) => t.name === "emit_output");
      for (const e of opts.emit?.[node] ?? []) await emitter!.handler(e, { config: {}, logger: silent });
      const nth = calls.filter((c) => c === node).length;
      const data = opts.data?.(node, nth) ?? { value: `${node}-out` };
      const usage = opts.usage?.(node, nth);
      const contained = opts.contained?.(node) ?? true;
      return { status: "success", data, toolCalls: [], contained, ...(usage ? { usage } : {}) } as NodeResult;
    },
    async evaluate() {
      throw new Error("no conditional routing in these specs");
    },
    async ask() {
      return "ALLOW";
    },
  };
  return { claude, calls, count: (node: string) => calls.filter((c) => c === node).length };
}

/**
 * A GitHub-shaped provider: issues live in memory, search finds a token in the
 * body. With `listing`, it also has `github_list_issues` (newest first).
 */
function fakeProvider(opts: { searchFails?: boolean; listing?: boolean } = {}) {
  const issues: { number: number; title: string; body: string; html_url: string; created_at: string }[] = [];
  let searches = 0;
  let lists = 0;
  const listTool = {
    name: "github_list_issues",
    description: "",
    input_schema: { type: "object" },
    access: "read" as const,
    handler: async () => {
      lists++;
      return [...issues].reverse();
    },
  };
  const skill: Skill = {
    id: "github",
    name: "GitHub",
    description: "",
    category: "git",
    config: {},
    tools: [
      {
        name: "github_search_issues",
        description: "",
        input_schema: { type: "object" },
        access: "read",
        handler: async (input: { query: string }) => {
          searches++;
          if (opts.searchFails) throw new Error("search unavailable");
          const token = input.query.split(" ")[0];
          return { items: issues.filter((i) => i.body.includes(token)) };
        },
      },
      {
        name: "github_create_issue",
        description: "",
        input_schema: { type: "object" },
        access: "write",
        handler: async (input: { title: string; body?: string }) => {
          const n = issues.length + 1;
          const issue = {
            number: n,
            title: input.title,
            body: input.body ?? "",
            html_url: `https://github.test/acme/api/issues/${n}`,
            created_at: new Date().toISOString(),
          };
          issues.push(issue);
          return issue;
        },
      },
      ...(opts.listing ? [listTool] : []),
    ],
  };
  return { skill, issues, searches: () => searches, lists: () => lists };
}

/** a -> b -> c -> d, every node read-only. */
function chain(over: Partial<Workflow> = {}): Workflow {
  const node = (id: string) => ({ name: id.toUpperCase(), instruction: `NODE:${id}`, skills: [] as string[] });
  return {
    id: "chain",
    name: "Chain",
    description: "",
    entry: "a",
    permissions: "read",
    nodes: { a: node("a"), b: node("b"), c: node("c"), d: node("d") },
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
    ],
    ...over,
  };
}

/** triage -> report (files one issue through safe outputs) -> notify. */
function reporting(): Workflow {
  return {
    id: "reporting",
    name: "Reporting",
    description: "",
    entry: "triage",
    nodes: {
      triage: { name: "Triage", instruction: "NODE:triage", skills: [], permissions: "read" },
      report: { name: "Report", instruction: "NODE:report", skills: ["github"], outputs: [{ type: "issue" }] },
      notify: { name: "Notify", instruction: "NODE:notify", skills: [], permissions: "read" },
    },
    edges: [
      { from: "triage", to: "report" },
      { from: "report", to: "notify" },
    ],
  };
}

const ISSUE = { type: "issue", title: "Crash on start", body: "Stack trace" };

function execOpts(agent: ReturnType<typeof fakeAgent>, skills: Skill[], cwd: string) {
  return {
    skills: createSkillMap(skills),
    claude: agent.claude,
    config: {},
    logger: silent,
    cwd,
    env: { GITHUB_REPOSITORY: "acme/api" },
  };
}

/** The first attempt. Returns true when it was killed. */
async function firstRun(
  cwd: string,
  workflow: Workflow,
  agent: ReturnType<typeof fakeAgent>,
  skills: Skill[] = [],
  faults?: JournalFaults,
): Promise<boolean> {
  const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults });
  try {
    const { results } = await execute(workflow, {}, { ...execOpts(agent, skills, cwd), journal });
    const killed = !journal.active;
    journal.end([...results.values()].some((r) => r.status === "failed") ? "failed" : "success");
    return killed;
  } catch (err) {
    if (err instanceof Kill) {
      processDied(cwd);
      return true;
    }
    throw err;
  }
}

/**
 * A killed process never releases its lock: it leaves it behind with a pid
 * that no longer runs. (These specs kill the run in-process, so the lock
 * would otherwise still name this live process.)
 */
function processDied(cwd: string): void {
  const lock = join(journalDir(cwd, RUN_ID), "lock");
  if (!existsSync(lock)) return;
  writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, started: 0, nonce: "dead" }));
}

/** Resume the way `sweny workflow resume` does. */
async function resumeRun(
  cwd: string,
  workflow: Workflow,
  agent: ReturnType<typeof fakeAgent>,
  skills: Skill[] = [],
  opts: ResumeOptions = {},
) {
  const prepared = prepareResume(RUN_ID, opts, { cwd, loadWorkflow: () => workflow });
  if (!prepared.ok || "planOnly" in prepared) return { prepared, results: undefined };
  let results: Map<string, NodeResult>;
  try {
    ({ results } = await execute(workflow, prepared.ctx.input, {
      ...execOpts(agent, skills, cwd),
      journal: prepared.ctx.journal,
    }));
  } catch (err) {
    if (err instanceof Kill) processDied(cwd);
    throw err;
  }
  prepared.ctx.journal.end([...results.values()].some((r) => r.status === "failed") ? "failed" : "success");
  return { prepared, results };
}

const journalFile = (cwd: string) => join(journalDir(cwd, RUN_ID), JOURNAL_FILE);

describe("run journal crash boundaries (#363)", () => {
  it("crash before a node starts: finished nodes replay, the next node runs once", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    expect(await firstRun(cwd, chain(), agent, [], killAt("node:start", "c"))).toBe(true);
    expect(agent.calls).toEqual(["a", "b"]);

    const { prepared, results } = await resumeRun(cwd, chain(), agent);
    expect(prepared.ok).toBe(true);
    expect(prepared.lines.join("\n")).toMatch(/✓ a\s+replay from journal/);
    expect(prepared.lines.join("\n")).toMatch(/▶ c\s+run \(not started before the crash\)/);
    expect(agent.calls).toEqual(["a", "b", "c", "d"]);
    expect([...results!.keys()]).toEqual(["a", "b", "c", "d"]);
    expect(results!.get("b")!.data).toEqual({ value: "b-out" });
  });

  it("crash mid-node: only the interrupted node runs again", async () => {
    const cwd = tmp();
    const agent = fakeAgent({ kill: (node, nth) => node === "c" && nth === 1 });
    expect(await firstRun(cwd, chain(), agent)).toBe(true);
    expect(agent.calls).toEqual(["a", "b", "c"]);

    const { prepared, results } = await resumeRun(cwd, chain(), agent);
    expect(prepared.lines.join("\n")).toMatch(/▶ c\s+run again$/m);
    expect(agent.calls).toEqual(["a", "b", "c", "c", "d"]);
    expect(results!.get("d")!.status).toBe("success");
  });

  it("crash mid-node on a node that can write: resume refuses until --allow-repeat-writes", async () => {
    const cwd = tmp();
    const wf = chain({ permissions: undefined });
    const agent = fakeAgent({ kill: (node, nth) => node === "b" && nth === 1 });
    expect(await firstRun(cwd, wf, agent)).toBe(true);
    const before = readFileSync(journalFile(cwd));

    const refused = await resumeRun(cwd, wf, agent);
    expect(refused.prepared.ok).toBe(false);
    expect(refused.prepared.ok === false && refused.prepared.error).toMatch(
      /b started before the crash.*--allow-repeat-writes/,
    );
    expect(refused.prepared.lines.join("\n")).toMatch(/▶ b\s+run again \(may repeat writes/);
    expect(agent.calls).toEqual(["a", "b"]);
    expect(readFileSync(journalFile(cwd)).equals(before)).toBe(true);

    await resumeRun(cwd, wf, agent, [], { allowRepeatWrites: true });
    expect(agent.calls).toEqual(["a", "b", "b", "c", "d"]);
  });

  it("crash after the agent result, before the journal write: that node runs again, earlier ones do not", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    expect(await firstRun(cwd, chain(), agent, [], killAt("node:end", "b"))).toBe(true);
    expect(agent.calls).toEqual(["a", "b"]);

    await resumeRun(cwd, chain(), agent);
    expect(agent.count("a")).toBe(1);
    expect(agent.count("b")).toBe(2);
    expect(agent.calls.slice(-2)).toEqual(["c", "d"]);
  });

  it("crash before the write-stage checkpoint: the agent runs again and the issue is filed once", async () => {
    const cwd = tmp();
    const gh = fakeProvider();
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    expect(await firstRun(cwd, reporting(), agent, [gh.skill], killAt("node:checkpoint", "report"))).toBe(true);
    expect(gh.issues).toHaveLength(0);

    const { results } = await resumeRun(cwd, reporting(), agent, [gh.skill]);
    expect(agent.count("triage")).toBe(1);
    expect(agent.count("report")).toBe(2);
    expect(gh.issues).toHaveLength(1);
    expect(results!.get("report")!.outputs).toEqual([
      expect.objectContaining({ type: "issue", status: "applied", ref: 1 }),
    ]);
  });

  it("crash after a safe output was applied, before its receipt: found by its key on the provider, not filed twice", async () => {
    const cwd = tmp();
    const gh = fakeProvider();
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    expect(await firstRun(cwd, reporting(), agent, [gh.skill], killAt("output:applied"))).toBe(true);
    expect(gh.issues).toHaveLength(1);
    const records = readJournal(journalFile(cwd)).records;
    const intent = records.find((r) => r.type === "output:intent")!;
    expect(records.some((r) => r.type === "output:applied")).toBe(false);
    expect(gh.issues[0].body).toContain(markerToken(intent.key as string));

    const { prepared, results } = await resumeRun(cwd, reporting(), agent, [gh.skill]);
    expect(prepared.lines.join("\n")).toMatch(
      /↻ report\s+write stage only: agent result reused; 1 write\(s\) to confirm/,
    );
    expect(agent.count("report")).toBe(1);
    expect(gh.searches()).toBe(1);
    expect(gh.issues).toHaveLength(1);
    expect(results!.get("report")!.outputs).toEqual([
      expect.objectContaining({
        type: "issue",
        status: "applied",
        ref: 1,
        url: "https://github.test/acme/api/issues/1",
      }),
    ]);
    expect(results!.get("notify")!.status).toBe("success");
    const recovered = readJournal(journalFile(cwd)).records.find((r) => r.type === "output:applied");
    expect(recovered).toMatchObject({ key: intent.key, recovered: true });
  });

  it("crash after the receipt, before the node ended: the receipt alone prevents a second write", async () => {
    const cwd = tmp();
    const gh = fakeProvider();
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    expect(await firstRun(cwd, reporting(), agent, [gh.skill], killAt("node:end", "report"))).toBe(true);
    expect(gh.issues).toHaveLength(1);

    const { results } = await resumeRun(cwd, reporting(), agent, [gh.skill]);
    expect(agent.count("report")).toBe(1);
    expect(gh.searches()).toBe(0);
    expect(gh.issues).toHaveLength(1);
    expect(results!.get("report")!.outputs).toEqual([expect.objectContaining({ status: "applied", ref: 1 })]);
  });

  it("an unconfirmable write fails the node instead of risking a duplicate", async () => {
    const cwd = tmp();
    const gh = fakeProvider({ searchFails: true });
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    await firstRun(cwd, reporting(), agent, [gh.skill], killAt("output:applied"));

    const { results } = await resumeRun(cwd, reporting(), agent, [gh.skill]);
    expect(gh.issues).toHaveLength(1);
    expect(results!.get("report")!.status).toBe("failed");
    expect(String(results!.get("report")!.data.error)).toMatch(/--allow-repeat-writes/);
    expect(results!.has("notify")).toBe(false);
  });

  it("torn journal append: the partial record is dropped and the run resumes from the last whole one", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    await firstRun(cwd, chain(), agent, [], killAt("node:start", "c"));
    appendFileSync(journalFile(cwd), '{"v":1,"seq":99,"type":"node:st');

    const { prepared } = await resumeRun(cwd, chain(), agent);
    expect(prepared.lines[0]).toMatch(/dropped a torn record at the end of the journal/);
    expect(agent.calls).toEqual(["a", "b", "c", "d"]);
    const after = readJournal(journalFile(cwd));
    expect(after.truncatedBytes).toBe(0);
    expect(after.records.at(-1)).toMatchObject({ type: "run:end", status: "success" });
  });

  it("damage in the middle of the journal is refused, not repaired", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    await firstRun(cwd, chain(), agent, [], killAt("node:start", "c"));
    const lines = readFileSync(journalFile(cwd), "utf-8").split("\n");
    lines.splice(2, 0, "garbage");
    writeFileSync(journalFile(cwd), lines.join("\n"));

    const { prepared } = await resumeRun(cwd, chain(), agent);
    expect(prepared.ok === false && prepared.error).toMatch(/damaged at line 3/);
    expect(agent.calls).toEqual(["a", "b"]);
  });

  it("workflow edited after the crash: resume is refused, the journal is untouched; --force resumes", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    await firstRun(cwd, chain(), agent, [], killAt("node:start", "c"));
    const before = readFileSync(journalFile(cwd));
    const edited = chain();
    edited.nodes.d = { ...edited.nodes.d, instruction: "NODE:d now does something else" };

    const refused = await resumeRun(cwd, edited, agent);
    expect(refused.prepared.ok === false && refused.prepared.error).toMatch(/changed since run .* started/);
    expect(agent.calls).toEqual(["a", "b"]);
    expect(readFileSync(journalFile(cwd)).equals(before)).toBe(true);

    const forced = await resumeRun(cwd, edited, agent, [], { force: true });
    expect(forced.prepared.lines.join("\n")).toMatch(/warning: --force: workflow wf.yml changed/);
    expect(agent.calls).toEqual(["a", "b", "c", "d"]);
  });

  it("instruction file edited after the crash: the executor refuses before any agent call", async () => {
    const cwd = tmp();
    writeFileSync(join(cwd, "d.md"), "NODE:d version one");
    const wf = chain();
    wf.nodes.d = { ...wf.nodes.d, instruction: { file: "d.md" } };
    const agent = fakeAgent();
    await firstRun(cwd, wf, agent, [], killAt("node:start", "c"));
    writeFileSync(join(cwd, "d.md"), "NODE:d version two");

    const prepared = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => wf });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok || "planOnly" in prepared) return;
    await expect(
      execute(wf, prepared.ctx.input, { ...execOpts(agent, [], cwd), journal: prepared.ctx.journal }),
    ).rejects.toBeInstanceOf(JournalMismatchError);
    expect(agent.calls).toEqual(["a", "b"]);
    expect(readJournal(journalFile(cwd)).records.some((r) => r.type === "run:resume")).toBe(false);
  });

  it("a run that finished successfully is not resumed", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    expect(await firstRun(cwd, chain(), agent)).toBe(false);
    const { prepared } = await resumeRun(cwd, chain(), agent);
    expect(prepared.ok === false && prepared.error).toMatch(/already finished successfully/);
    expect(agent.calls).toEqual(["a", "b", "c", "d"]);
  });

  it("expression routes (#470) are journaled and replayed, not re-decided", async () => {
    const cwd = tmp();
    const wf: Workflow = {
      id: "routed",
      name: "Routed",
      description: "",
      entry: "a",
      permissions: "read",
      nodes: {
        a: {
          name: "A",
          instruction: "NODE:a",
          skills: [],
          output: { type: "object", properties: { go: { type: "string" } }, required: ["go"] },
        },
        b: { name: "B", instruction: "NODE:b", skills: [] },
        c: { name: "C", instruction: "NODE:c", skills: [] },
      },
      edges: [
        { from: "a", to: "b", when: { expr: "a.go == 'b'" } },
        { from: "a", to: "c", when: { expr: "a.go == 'c'" } },
      ],
    };
    // Attempt 1 routes to c; any later decision for a would route to b.
    const agent = fakeAgent({ data: (node, nth) => (node === "a" ? { go: nth === 1 ? "c" : "b" } : undefined) });
    expect(await firstRun(cwd, wf, agent, [], killAt("node:start", "c"))).toBe(true);
    const routes = readJournal(journalFile(cwd)).records.filter((r) => r.type === "route");
    expect(routes).toEqual([expect.objectContaining({ from: "a", to: "c" })]);

    const { results } = await resumeRun(cwd, wf, agent);
    expect(agent.calls).toEqual(["a", "c"]);
    expect(results!.has("b")).toBe(false);
    expect(results!.get("c")!.status).toBe("success");
  });

  it("a second crash, then a second resume: each finished node still ran once", async () => {
    const cwd = tmp();
    const agent = fakeAgent({ kill: (node, nth) => (node === "b" || node === "d") && nth === 1 });
    await firstRun(cwd, chain(), agent);
    await expect(resumeRun(cwd, chain(), agent)).rejects.toBeInstanceOf(Kill);
    expect(agent.calls).toEqual(["a", "b", "b", "c", "d"]);

    const { prepared, results } = await resumeRun(cwd, chain(), agent);
    expect(prepared.lines[0]).toMatch(/attempt 3/);
    expect(agent.calls).toEqual(["a", "b", "b", "c", "d", "d"]);
    expect(results!.get("d")!.status).toBe("success");
  });
});

describe("resume keeps the run's spend", () => {
  it("90 tokens journaled, then 20 on resume: the resumed node fails a 100-token run budget at 110", async () => {
    const cwd = tmp();
    const wf = chain({ budget: { tokens: 100 } });
    const agent = fakeAgent({ usage: (node) => ({ inputTokens: node === "a" ? 90 : 20, outputTokens: 0 }) });
    expect(await firstRun(cwd, wf, agent, [], killAt("node:start", "b"))).toBe(true);

    const { results } = await resumeRun(cwd, wf, agent);
    expect(agent.calls).toEqual(["a", "b"]);
    const b = results!.get("b")!;
    expect(b.status).toBe("failed");
    expect(b.data.budget_exceeded).toBe(true);
    expect(b.budget).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 110 });
    expect(results!.has("c")).toBe(false);
  });

  it("spend reported live before a crash mid-node still counts: the node does not start again", async () => {
    const cwd = tmp();
    const wf = chain({ budget: { tokens: 100 } });
    const agent = fakeAgent({
      usage: (node) => (node === "a" ? { inputTokens: 50, outputTokens: 0 } : undefined),
      live: (node, nth) => (node === "b" && nth === 1 ? { inputTokens: 60, outputTokens: 0 } : undefined),
      kill: (node, nth) => node === "b" && nth === 1,
    });
    expect(await firstRun(cwd, wf, agent)).toBe(true);
    expect(agent.calls).toEqual(["a", "b"]);

    const { results } = await resumeRun(cwd, wf, agent);
    expect(agent.calls).toEqual(["a", "b"]);
    const b = results!.get("b")!;
    expect(b.status).toBe("failed");
    expect(b.budget).toEqual({ scope: "run", unit: "tokens", limit: 100, spent: 110 });
  });
});

describe("resume keeps the executor's own spend (judge, route, ...)", () => {
  const t = (n: number): NodeUsage => ({ inputTokens: n, outputTokens: 0 });

  it("130 spent (10 node + 120 judge), resume spends 40 more: a 150 run budget stops at 170", async () => {
    const cwd = tmp();
    const base = chain({ budget: { tokens: 150 } });
    const wf: Workflow = {
      ...base,
      nodes: {
        ...base.nodes,
        a: { ...base.nodes.a, eval: [{ name: "j", kind: "judge", rubric: "is it good?", pass_when: "yes" }] },
      },
    };
    const agent = fakeAgent({ usage: (node) => t(node === "a" ? 10 : 40) });
    agent.claude.ask = async (opts) => {
      opts.onUsage?.(t(120));
      return "VERDICT: yes\nREASONING: ok";
    };
    expect(await firstRun(cwd, wf, agent, [], killAt("node:start", "b"))).toBe(true);
    const meters = readJournal(journalFile(cwd)).records.filter((r) => r.type === "meter");
    expect(meters).toEqual([expect.objectContaining({ kind: "judge", node: "a", iteration: 1, tokens: 120 })]);

    const { prepared, results } = await resumeRun(cwd, wf, agent);
    expect(prepared.ok && "ctx" in prepared && prepared.ctx.plan.priorSpend).toEqual({
      tokens: 130,
      costUsd: 0,
      byKind: { node: { tokens: 10, costUsd: 0 }, judge: { tokens: 120, costUsd: 0 } },
    });
    expect(agent.calls).toEqual(["a", "b"]);
    const b = results!.get("b")!;
    expect(b.status).toBe("failed");
    expect(b.budget).toEqual({ scope: "run", unit: "tokens", limit: 150, spent: 170 });
  });

  it("a route meter record sits after node:end and the journal still passes the integrity check", async () => {
    const cwd = tmp();
    const wf = chain({
      budget: { tokens: 1000 },
      edges: [
        { from: "a", to: "b", when: "go on" },
        { from: "a", to: "c", when: "stop" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
      ],
    });
    const agent = fakeAgent({ usage: () => t(10) });
    agent.claude.evaluate = async (opts) => {
      opts.onUsage?.(t(7));
      return "b";
    };
    expect(await firstRun(cwd, wf, agent, [], killAt("node:start", "b"))).toBe(true);
    const types = readJournal(journalFile(cwd)).records.map((r) =>
      r.type === "meter" ? `meter:${String(r.kind)}` : r.type,
    );
    const end = types.indexOf("node:end");
    expect(types.slice(end, end + 3)).toEqual(["node:end", "meter:route", "route"]);

    const { prepared, results } = await resumeRun(cwd, wf, agent);
    expect(prepared.ok).toBe(true);
    expect(prepared.ok && "ctx" in prepared && prepared.ctx.plan.priorSpend.byKind?.route).toEqual({
      tokens: 7,
      costUsd: 0,
    });
    expect(results!.get("d")!.status).toBe("success");
  });

  it("the sequence check refuses a route meter inside the visit, and a reused call id", () => {
    const head = [
      { seq: 1, type: "run:start", run_id: "r", workflow_entry: "a" },
      { seq: 2, type: "node:start", node: "a", iteration: 1 },
    ] as unknown as JournalRecord[];
    const meter = (seq: number, kind: string, call: string) =>
      ({ seq, type: "meter", kind, call, node: "a", iteration: 1, tokens: 5, cost_usd: 0 }) as unknown as JournalRecord;
    expect(() => checkRecordSequence([...head, meter(3, "route", "c1")])).toThrow(/outside a finished, unrouted visit/);
    expect(() => checkRecordSequence([...head, meter(3, "judge", "c1"), meter(4, "judge", "c1")])).toThrow(/call id/);
    expect(() => checkRecordSequence([...head, meter(3, "node", "c1")])).toThrow(/unknown kind/);
    expect(() => checkRecordSequence([...head, meter(3, "judge", "c1"), meter(4, "screen", "c2")])).not.toThrow();
  });
});

describe("budget stops and resume (round 2)", () => {
  const t = (n: number): NodeUsage => ({ inputTokens: n, outputTokens: 0 });
  const routed = () =>
    chain({
      edges: [
        { from: "a", to: "b", when: "go on" },
        { from: "a", to: "d", when: "stop" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
      ],
    });
  async function runCapped(
    cwd: string,
    wf: Workflow,
    agent: ReturnType<typeof fakeAgent>,
    cap: number,
    faults?: JournalFaults,
  ) {
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults });
    try {
      const out = await execute(wf, {}, { ...execOpts(agent, [], cwd), journal, budget: { tokens: cap } });
      journal.end("failed");
      return out;
    } catch (err) {
      if (err instanceof Kill) {
        processDied(cwd);
        return undefined;
      }
      throw err;
    }
  }
  async function resumeCapped(
    cwd: string,
    wf: Workflow,
    agent: ReturnType<typeof fakeAgent>,
    cap: number,
    skills: Skill[] = [],
  ) {
    const prepared = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => wf });
    if (!prepared.ok || "planOnly" in prepared) throw new Error("resume refused");
    const out = await execute(wf, prepared.ctx.input, {
      ...execOpts(agent, skills, cwd),
      journal: prepared.ctx.journal,
      budget: { tokens: cap },
    });
    prepared.ctx.journal.end("success");
    return out;
  }

  it("a budget stop at a route writes no route record: a resume with a larger cap routes on", async () => {
    const cwd = tmp();
    const wf = routed();
    const agent = fakeAgent({ usage: (node) => t(node === "a" ? 50 : 1) });
    let routes = 0;
    agent.claude.evaluate = async () => {
      routes++;
      return "b";
    };
    const first = await runCapped(cwd, wf, agent, 50);
    expect(first!.results.get("a")!.budget).toMatchObject({ scope: "run", spent: 50 });
    expect(routes).toBe(0);
    expect(readJournal(journalFile(cwd)).records.some((r) => r.type === "route")).toBe(false);

    const { results } = await resumeCapped(cwd, wf, agent, 1000);
    expect(routes).toBe(1);
    expect(agent.calls).toEqual(["a", "b", "c", "d"]);
    expect([...results.values()].every((r) => r.status === "success")).toBe(true);
  });

  it("replay routing after a crash is gated too: a spent run budget makes no second route call", async () => {
    const cwd = tmp();
    const wf = routed();
    const agent = fakeAgent({ usage: () => t(10) });
    let routes = 0;
    agent.claude.evaluate = async (opts) => {
      routes++;
      opts.onUsage?.(t(30));
      return "b";
    };
    // The route call crosses (10 + 30 against 25); the process dies before the route record.
    await runCapped(cwd, wf, agent, 25, killAt("route"));
    expect(routes).toBe(1);

    const { results } = await resumeCapped(cwd, wf, agent, 25);
    expect(routes).toBe(1);
    expect(agent.calls).toEqual(["a"]);
    expect(results.get("a")!.budget).toMatchObject({ scope: "run", limit: 25, spent: 40 });
    expect(results.has("b")).toBe(false);
  });

  const screenedReporting = (over: Partial<Workflow["nodes"][string]> = {}): Workflow => {
    const wf = reporting();
    return {
      ...wf,
      safe_outputs: { screen: true },
      nodes: { ...wf.nodes, report: { ...wf.nodes.report, ...over } },
    };
  };

  it("checkpoint resume keeps a write already applied, and does not screen it again", async () => {
    // Cap 50: report's agent 40 + screen 10, the issue is filed, then the process dies before node:end.
    const cwd = tmp();
    const gh = fakeProvider();
    const wf = screenedReporting();
    const agent = fakeAgent({ emit: { report: [ISSUE] }, usage: (node) => (node === "report" ? t(40) : undefined) });
    let screens = 0;
    agent.claude.ask = async (opts) => {
      screens++;
      opts.onUsage?.(t(10));
      return "ALLOW";
    };
    const journal = RunJournal.create({
      runId: RUN_ID,
      cwd,
      workflowFile: "wf.yml",
      faults: killAt("node:end", "report"),
    });
    await expect(
      execute(wf, {}, { ...execOpts(agent, [gh.skill], cwd), journal, budget: { tokens: 50 } }),
    ).rejects.toBeInstanceOf(Kill);
    processDied(cwd);
    expect(gh.issues).toHaveLength(1);

    const { results } = await resumeCapped(cwd, wf, agent, 50, [gh.skill]);
    expect(screens).toBe(1);
    expect(gh.issues).toHaveLength(1);
    expect(results.get("report")!.outputs).toEqual([
      expect.objectContaining({
        type: "issue",
        status: "applied",
        ref: 1,
        url: "https://github.test/acme/api/issues/1",
      }),
    ]);
  });

  it("checkpoint resume restores the visit's node budget: an exhausted visit screens nothing more", async () => {
    // Node limit 50: agent 10, screen 60 -> failed at 70, write vetoed.
    const cwd = tmp();
    const gh = fakeProvider();
    const wf = screenedReporting({ budget: { tokens: 50 } });
    const agent = fakeAgent({ emit: { report: [ISSUE] }, usage: (node) => (node === "report" ? t(10) : undefined) });
    let screens = 0;
    agent.claude.ask = async (opts) => {
      screens++;
      opts.onUsage?.(t(screens === 1 ? 60 : 10));
      return "ALLOW";
    };
    expect(await firstRun(cwd, wf, agent, [gh.skill])).toBe(false);
    expect(gh.issues).toHaveLength(0);

    const { results } = await resumeRun(cwd, wf, agent, [gh.skill]);
    expect(screens).toBe(1);
    expect(gh.issues).toHaveLength(0);
    const report = results!.get("report")!;
    expect(report.status).toBe("failed");
    expect(report.budget).toMatchObject({ scope: "node", limit: 50 });
    expect(report.outputs?.[0]).toMatchObject({ status: "vetoed" });
  });
});

describe("budget and resume (round 3)", () => {
  const t = (n: number): NodeUsage => ({ inputTokens: n, outputTokens: 0 });

  it("a visit re-run after a mid-agent crash keeps its node spend: 30 live, killed, 30 again crosses a 50 limit", async () => {
    const cwd = tmp();
    const base = chain();
    const wf: Workflow = { ...base, nodes: { ...base.nodes, b: { ...base.nodes.b, budget: { tokens: 50 } } } };
    const agent = fakeAgent({
      live: (node) => (node === "b" ? t(30) : undefined),
      usage: (node) => (node === "b" ? t(30) : undefined),
      kill: (node, nth) => node === "b" && nth === 1,
    });
    expect(await firstRun(cwd, wf, agent)).toBe(true);

    const { results } = await resumeRun(cwd, wf, agent);
    expect(agent.count("b")).toBe(2);
    const b = results!.get("b")!;
    expect(b.status).toBe("failed");
    expect(b.budget).toMatchObject({ scope: "node", limit: 50, spent: 60 });
    expect(results!.has("c")).toBe(false);
  });

  const screenedReporting = (): Workflow => ({ ...reporting(), safe_outputs: { screen: true } });
  const reportingAgent = () => {
    const agent = fakeAgent({ emit: { report: [ISSUE] }, usage: (node) => (node === "report" ? t(40) : undefined) });
    agent.claude.ask = async (opts) => {
      opts.onUsage?.(t(10));
      return "ALLOW";
    };
    return agent;
  };
  async function crashBeforeReceipt(
    cwd: string,
    wf: Workflow,
    agent: ReturnType<typeof fakeAgent>,
    gh: ReturnType<typeof fakeProvider>,
  ) {
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults: killAt("output:applied") });
    try {
      await execute(wf, {}, { ...execOpts(agent, [gh.skill], cwd), journal, budget: { tokens: 50 } });
    } catch (err) {
      if (!(err instanceof Kill)) throw err;
    }
    // The kill lands inside the write handler: the journal is dead, as a killed process leaves it.
    expect(journal.active).toBe(false);
    processDied(cwd);
  }
  async function resume50(
    cwd: string,
    wf: Workflow,
    agent: ReturnType<typeof fakeAgent>,
    gh: ReturnType<typeof fakeProvider>,
  ) {
    const prepared = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => wf });
    if (!prepared.ok || "planOnly" in prepared) throw new Error("resume refused");
    const out = await execute(wf, prepared.ctx.input, {
      ...execOpts(agent, [gh.skill], cwd),
      journal: prepared.ctx.journal,
      budget: { tokens: 50 },
    });
    prepared.ctx.journal.end("failed");
    return out;
  }

  it("a write that landed before its receipt was saved is found on the provider before the screen, not vetoed", async () => {
    const cwd = tmp();
    const gh = fakeProvider();
    const wf = screenedReporting();
    const agent = reportingAgent();
    await crashBeforeReceipt(cwd, wf, agent, gh);
    expect(gh.issues).toHaveLength(1);

    const { results } = await resume50(cwd, wf, agent, gh);
    expect(gh.issues).toHaveLength(1);
    expect(gh.searches()).toBeGreaterThan(0);
    expect(results.get("report")!.outputs).toEqual([
      expect.objectContaining({ status: "applied", ref: 1, url: "https://github.test/acme/api/issues/1" }),
    ]);
  });

  it("reconcile and the write handler share one provider probe per write", async () => {
    // The process dies before the intent is recorded: the stage replays, the probe finds nothing, the write is sent.
    const cwd = tmp();
    const gh = fakeProvider();
    const wf = screenedReporting();
    const agent = reportingAgent();
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults: killAt("output:intent") });
    try {
      await execute(wf, {}, { ...execOpts(agent, [gh.skill], cwd), journal, budget: { tokens: 1000 } });
    } catch (err) {
      if (!(err instanceof Kill)) throw err;
    }
    expect(journal.active).toBe(false);
    processDied(cwd);
    expect(gh.issues).toHaveLength(0);

    const prepared = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => wf });
    if (!prepared.ok || "planOnly" in prepared) throw new Error("resume refused");
    const { results } = await execute(wf, prepared.ctx.input, {
      ...execOpts(agent, [gh.skill], cwd),
      journal: prepared.ctx.journal,
      budget: { tokens: 1000 },
    });
    prepared.ctx.journal.end("success");
    expect(gh.searches()).toBe(1);
    expect(gh.issues).toHaveLength(1);
    expect(results.get("report")!.outputs![0]).toMatchObject({ status: "applied", ref: 1 });
  });

  it("when the probe cannot run, the write stays uncertain: never reported vetoed", async () => {
    const cwd = tmp();
    const gh = fakeProvider({ searchFails: true });
    const wf = screenedReporting();
    const agent = reportingAgent();
    await crashBeforeReceipt(cwd, wf, agent, gh);

    const { results } = await resume50(cwd, wf, agent, gh);
    expect(gh.issues).toHaveLength(1);
    const out = results.get("report")!.outputs![0];
    expect(out.status).not.toBe("vetoed");
    expect(String(results.get("report")!.data.error)).toMatch(/cannot confirm/);
  });
});

describe("journal integrity (security review 3, finding 3)", () => {
  const lines = (cwd: string) => readFileSync(journalFile(cwd), "utf-8").split("\n").filter(Boolean);
  /** Every file under `dir`, recursively. */
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  /** Crash on the final usage append of node a: the head holds the record, the journal never got it. */
  const crashOnUsage = (): JournalFaults => ({
    afterHeadUpdate(rec) {
      if (rec.type === "usage") throw new Kill("usage append");
    },
  });

  it("crash on a usage append: nothing in the workspace can cut it, and the spend is restored", async () => {
    const cwd = tmp();
    const wf = chain({ budget: { tokens: 100 } });
    const agent = fakeAgent({ usage: (node) => ({ inputTokens: node === "a" ? 90 : 20, outputTokens: 0 }) });
    expect(await firstRun(cwd, wf, agent, [], crashOnUsage())).toBe(true);
    // The reviewer's attack needs a journal line to delete. The workspace has none.
    expect(walk(cwd).filter((f) => f.endsWith(JOURNAL_FILE))).toEqual([]);
    expect(journalFile(cwd).startsWith(cwd)).toBe(false);
    // Whatever an agent does to the workspace's .sweny dir changes nothing.
    rmSync(join(cwd, ".sweny"), { recursive: true, force: true });

    const { prepared, results } = await resumeRun(cwd, wf, agent);
    expect(prepared.ok).toBe(true);
    expect(prepared.lines.join("\n")).toMatch(/restored the journal's last record from the head/);
    // 90 journaled (restored from the head) + 90 for re-running a: the 100-token budget fails instead of resetting.
    const a = results!.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.budget).toEqual(expect.objectContaining({ scope: "run", limit: 100 }));
    expect(results!.has("b")).toBe(false);
  });

  it("the same attack on the state file itself (delete the final line, then one more) is refused", async () => {
    const cwd = tmp();
    const wf = chain({ budget: { tokens: 100 } });
    const agent = fakeAgent({ usage: (node) => ({ inputTokens: node === "a" ? 90 : 20, outputTokens: 0 }) });
    await firstRun(cwd, wf, agent, [], crashOnUsage());
    const all = lines(cwd);
    const cut = all.slice(0, -1).join("\n") + "\n";
    writeFileSync(journalFile(cwd), cut);

    const { prepared } = await resumeRun(cwd, wf, agent);
    expect(prepared.ok === false && prepared.error).toMatch(/rolled back/);
    expect(agent.calls).toEqual(["a"]);
    expect(readFileSync(journalFile(cwd), "utf-8")).toBe(cut);
    // --force does not bypass it.
    const forced = await resumeRun(cwd, wf, agent, [], { force: true });
    expect(forced.prepared.ok === false && forced.prepared.error).toMatch(/rolled back/);
  });

  it("a journal cut back at a prior newline after a clean stop is refused", async () => {
    const cwd = tmp();
    const wf = chain({ budget: { tokens: 100 } });
    const agent = fakeAgent({ usage: (node) => ({ inputTokens: node === "a" ? 90 : 20, outputTokens: 0 }) });
    expect(await firstRun(cwd, wf, agent, [], killAt("node:start", "b"))).toBe(true);
    const all = lines(cwd);
    const usageAt = all.findIndex((l) => JSON.parse(l).type === "usage");
    writeFileSync(journalFile(cwd), all.slice(0, usageAt).join("\n") + "\n");
    const { prepared } = await resumeRun(cwd, wf, agent);
    expect(prepared.ok === false && prepared.error).toMatch(/rolled back/);
    expect(agent.calls).toEqual(["a"]);
  });

  it("a complete record with a bad signature and no line end is refused, not trimmed as torn", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    await firstRun(cwd, chain(), agent, [], killAt("node:start", "c"));
    const n = lines(cwd).length;
    const body = { v: 3, seq: n + 1, type: "node:start", at: "2026-10-01T00:00:00.000Z", node: "c", iteration: 1 };
    appendFileSync(journalFile(cwd), JSON.stringify({ ...body, h: "0".repeat(64) }));
    const before = readFileSync(journalFile(cwd));

    const { prepared } = await resumeRun(cwd, chain(), agent);
    expect(prepared.ok === false && prepared.error).toMatch(new RegExp(`line ${n + 1} fails authentication`));
    expect(agent.calls).toEqual(["a", "b"]);
    expect(readFileSync(journalFile(cwd)).equals(before)).toBe(true);
  });

  it("a genuine torn final write (half the record reached the journal) still resumes", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    let pending = "";
    const faults: JournalFaults = {
      afterHeadUpdate(rec) {
        if (rec.type === "node:start" && rec.node === "c") {
          pending = JSON.stringify(rec) + "\n";
          throw new Kill("node:start c");
        }
      },
    };
    expect(await firstRun(cwd, chain(), agent, [], faults)).toBe(true);
    appendFileSync(journalFile(cwd), pending.slice(0, Math.floor(pending.length / 2)));

    const { prepared } = await resumeRun(cwd, chain(), agent);
    expect(prepared.lines[0]).toMatch(/dropped a torn record/);
    expect(agent.calls).toEqual(["a", "b", "c", "d"]);
    expect(readJournal(journalFile(cwd)).records.at(-1)).toMatchObject({ type: "run:end", status: "success" });
  });

  it("crash between the head write and the journal append: the record is restored, b is replayed not re-run", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    const faults: JournalFaults = {
      afterHeadUpdate(rec) {
        if (rec.type === "node:end" && rec.node === "b") throw new Kill("journal append of node:end b");
      },
    };
    expect(await firstRun(cwd, chain(), agent, [], faults)).toBe(true);
    expect(JSON.parse(lines(cwd).at(-1)!)).toMatchObject({ type: "node:start", node: "b" });

    const { prepared } = await resumeRun(cwd, chain(), agent);
    expect(prepared.ok).toBe(true);
    expect(agent.calls).toEqual(["a", "b", "c", "d"]);
    expect(readJournal(journalFile(cwd)).records.at(-1)).toMatchObject({ type: "run:end", status: "success" });
  });

  it("a journal written by an older sweny in the workspace is refused with a clear message", async () => {
    const cwd = tmp();
    const legacy = join(cwd, ".sweny", "runs", RUN_ID);
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, JOURNAL_FILE), '{"v":2,"seq":1,"type":"run:start","h":"x"}\n');
    const prepared = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => chain() });
    expect(prepared.ok === false && prepared.error).toMatch(/written by an older sweny.*cannot be resumed safely/);
  });
});

describe("a journal append that fails stops the run", () => {
  /** An I/O failure writing a record of `type` (for `node`, when given). */
  const failWrite = (type: string, node?: string): JournalFaults => ({
    writeJournal(fd, line) {
      const rec = JSON.parse(line) as JournalRecord;
      if (rec.type === type && (node === undefined || rec.node === node)) throw new Error("ENOSPC: no space left");
      writeSync(fd, line);
    },
  });

  it("node:end cannot be written: the node fails with the reason and nothing after it runs", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    const journal = RunJournal.create({
      runId: RUN_ID,
      cwd,
      workflowFile: "wf.yml",
      faults: failWrite("node:end", "a"),
    });
    const { results } = await execute(chain(), {}, { ...execOpts(agent, [], cwd), journal });
    expect(agent.calls).toEqual(["a"]);
    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.data).toMatchObject({ journal_failed: true });
    expect(String(a.data.error)).toMatch(/run journal: could not write .*ENOSPC/);
    expect(results.has("b")).toBe(false);
    expect(journal.active).toBe(false);
    journal.end("failed");
  });

  it("a live usage record cannot be written: the agent is stopped and the node fails", async () => {
    const cwd = tmp();
    let aborted = false;
    const agent = fakeAgent({ live: (node) => (node === "a" ? { inputTokens: 50, outputTokens: 0 } : undefined) });
    const run = agent.claude.run.bind(agent.claude);
    agent.claude.run = async (req) => {
      const out = await run(req);
      aborted = req.signal?.aborted === true;
      return out;
    };
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", faults: failWrite("usage") });
    const { results } = await execute(chain(), {}, { ...execOpts(agent, [], cwd), journal });
    expect(aborted).toBe(true);
    expect(results.get("a")!.status).toBe("failed");
    expect(results.get("a")!.data).toMatchObject({ journal_failed: true });
    expect(results.has("b")).toBe(false);
    journal.end("failed");
  });

  it("a write intent cannot be journaled: the write is never sent", async () => {
    const cwd = tmp();
    const gh = fakeProvider();
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    const journal = RunJournal.create({
      runId: RUN_ID,
      cwd,
      workflowFile: "wf.yml",
      faults: failWrite("output:intent"),
    });
    const { results } = await execute(reporting(), {}, { ...execOpts(agent, [gh.skill], cwd), journal });
    expect(gh.issues).toHaveLength(0);
    expect(results.get("report")!.status).toBe("failed");
    expect(results.get("report")!.data).toMatchObject({ journal_failed: true });
    expect(results.has("notify")).toBe(false);
    journal.end("failed");
  });
});

describe("review 4 follow-ups", () => {
  it("live usage is on disk the moment it is reported: 10 then 100, process killed at once, resume seeds 100", async () => {
    const cwd = tmp();
    const claude: Claude = {
      async run(req) {
        req.onUsage?.({ inputTokens: 10, outputTokens: 0 });
        req.onUsage?.({ inputTokens: 100, outputTokens: 0 });
        // SIGKILL right after the second report: no timer, no flush, no end() ever runs.
        throw new Kill("process killed");
      },
      async evaluate() {
        throw new Error("unused");
      },
      async ask() {
        return "ALLOW";
      },
    };
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml" });
    await expect(
      execute(chain(), {}, { skills: createSkillMap([]), claude, config: {}, logger: silent, cwd, journal }),
    ).rejects.toBeInstanceOf(Kill);
    processDied(cwd);
    const usage = readJournal(journalFile(cwd)).records.filter((r) => r.type === "usage");
    expect(usage.map((r) => r.tokens)).toEqual([10, 100]);

    const prepared = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => chain() });
    expect(prepared.ok && "ctx" in prepared && prepared.ctx.plan.priorSpend.tokens).toBe(100);
    if (prepared.ok && "ctx" in prepared) prepared.ctx.journal.end("crashed");
  });

  it("crash after an issue was filed, before its receipt: the listing finds its marker, it is not filed again", async () => {
    const cwd = tmp();
    const gh = fakeProvider({ listing: true });
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    expect(await firstRun(cwd, reporting(), agent, [gh.skill], killAt("output:applied"))).toBe(true);
    expect(gh.issues).toHaveLength(1);

    const { results } = await resumeRun(cwd, reporting(), agent, [gh.skill]);
    expect(gh.lists()).toBe(1);
    expect(gh.searches()).toBe(0);
    expect(gh.issues).toHaveLength(1);
    expect(results!.get("report")!.outputs).toEqual([expect.objectContaining({ status: "applied", ref: 1 })]);
  });

  it("the write died after its intent, before it landed: the listing proves it absent, it is filed once", async () => {
    const cwd = tmp();
    const gh = fakeProvider({ listing: true });
    const create = gh.skill.tools.find((t) => t.name === "github_create_issue")!;
    const real = create.handler;
    let calls = 0;
    create.handler = async (input, ctx) => {
      calls++;
      if (calls === 1) throw new Kill("died before the API call landed");
      return real(input, ctx);
    };
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    await firstRun(cwd, reporting(), agent, [gh.skill]);
    expect(gh.issues).toHaveLength(0);
    const records = readJournal(journalFile(cwd)).records;
    expect(records.some((r) => r.type === "output:intent")).toBe(true);
    expect(records.some((r) => r.type === "output:applied")).toBe(false);

    await resumeRun(cwd, reporting(), agent, [gh.skill]);
    expect(gh.lists()).toBe(1);
    expect(gh.issues).toHaveLength(1);
  });

  it("an agent that ran without an enforced sandbox: resume warns and the receipt carries journal_unsandboxed", async () => {
    const cwd = tmp();
    const agent = fakeAgent({ contained: (node) => node !== "a" });
    await firstRun(cwd, chain(), agent, [], killAt("node:start", "c"));
    expect(readJournal(journalFile(cwd)).records.some((r) => r.type === "agent:unsandboxed" && r.node === "a")).toBe(
      true,
    );

    const { prepared, results } = await resumeRun(cwd, chain(), agent);
    expect(prepared.ok).toBe(true);
    expect(prepared.lines.join("\n")).toMatch(/ran a without an enforced sandbox.*journal_unsandboxed/);
    for (const r of results!.values()) {
      expect((r.degraded ?? []).some((d) => d.startsWith("journal_unsandboxed:"))).toBe(true);
    }
  });

  it("a fully sandboxed run resumes with no such warning", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    await firstRun(cwd, chain(), agent, [], killAt("node:start", "c"));
    const { prepared, results } = await resumeRun(cwd, chain(), agent);
    expect(prepared.lines.join("\n")).not.toMatch(/without an enforced sandbox/);
    for (const r of results!.values()) expect(r.degraded ?? []).not.toContainEqual(expect.stringMatching(/^journal_/));
  });
});

describe("one resume at a time", () => {
  it("a second resume while the first holds the run is refused; after it ends, the run resumes", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    await firstRun(cwd, chain(), agent, [], killAt("node:start", "c"));
    const first = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => chain() });
    expect(first.ok && "ctx" in first).toBe(true);
    const second = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => chain() });
    expect(second.ok === false && second.error).toMatch(/in use by process/);
    if (first.ok && "ctx" in first) first.ctx.journal.end("crashed");
    const third = prepareResume(RUN_ID, { plan: true }, { cwd, loadWorkflow: () => chain() });
    expect(third.ok).toBe(true);
  });

  it("two resumes racing for a crashed run's stale lock: exactly one gets the run", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    await firstRun(cwd, chain(), agent, [], killAt("node:start", "c"));
    // A crashed process leaves its lock behind: a pid that no longer runs.
    writeFileSync(join(journalDir(cwd, RUN_ID), "lock"), JSON.stringify({ pid: DEAD_PID, started: 0, nonce: "x" }));
    let inner: ReturnType<typeof prepareResume> | undefined;
    const outer = prepareResume(
      RUN_ID,
      {},
      {
        cwd,
        loadWorkflow: () => chain(),
        lockHooks: {
          afterStaleRead() {
            inner ??= prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => chain() });
          },
        },
      },
    );
    expect(inner?.ok && "ctx" in inner).toBe(true);
    expect(outer.ok === false && outer.error).toMatch(/in use by process/);
    if (inner?.ok && "ctx" in inner) inner.ctx.journal.end("crashed");
  });
});

describe("replayed control flow must be real", () => {
  it("a journaled route that is not an edge of the workflow is refused before any node runs", async () => {
    const cwd = tmp();
    const agent = fakeAgent();
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml" });
    journal.begin({
      workflow: chain(),
      input: {},
      sources: {},
      skills: new Map(),
      config: {},
      writeState: createWriteStageState(),
    });
    journal.nodeStart("a", 1);
    journal.nodeEnd("a", 1, { status: "success", data: {}, toolCalls: [] }, createWriteStageState());
    // a -> d skips b and c: no such edge.
    journal.route("a", "d");
    journal.end("crashed");

    const { prepared } = await resumeRun(cwd, chain(), agent);
    expect(prepared.ok).toBe(false);
    expect(prepared.ok === false && prepared.error).toMatch(/a -> d.*not an edge/);
    expect(agent.calls).toEqual([]);
  });
});

describe("a write handler's refusal in the journal (#544)", () => {
  it("node:end records the write as refused with the handler's reason, never applied", async () => {
    const cwd = tmp();
    const gh = fakeProvider();
    const create = gh.skill.tools.find((t) => t.name === "github_create_issue")!;
    create.handler = async () => ({
      refused: true,
      reason: "the tool could not vouch for this write",
      detail: "upstream specifics stay in the tool result",
    });
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    expect(await firstRun(cwd, reporting(), agent, [gh.skill])).toBe(false);
    const end = readJournal(journalFile(cwd)).records.find((r) => r.type === "node:end" && r.node === "report");
    const result = end!.result as NodeResult;
    expect(result.status).toBe("failed");
    expect(result.outputs).toEqual([
      expect.objectContaining({ type: "issue", status: "refused", reason: "the tool could not vouch for this write" }),
    ]);
    expect(JSON.stringify(result.outputs)).not.toContain("applied");
    expect(JSON.stringify(end)).not.toContain("upstream specifics");
  });

  /** A provider whose create handler refuses `times` times (then files the issue), optionally after filing it. */
  function refusingProvider(o: { times: number; transient?: boolean; filesFirst?: boolean }) {
    // With a listing tool the lookup on resume can prove a write absent (search alone cannot).
    const gh = fakeProvider({ listing: true });
    const create = gh.skill.tools.find((t) => t.name === "github_create_issue")!;
    const real = create.handler;
    let calls = 0;
    create.handler = async (input: unknown, ctx: ToolContext) => {
      calls++;
      if (calls > o.times) return real(input, ctx);
      const filed = o.filesFirst ? ((await real(input, ctx)) as { number: number; html_url: string }) : undefined;
      return {
        refused: true,
        reason: "the tool could not vouch for this write",
        detail: "upstream specifics stay in the tool result",
        ...(o.transient ? { transient: true } : {}),
        ...(filed ? { number: filed.number, html_url: filed.html_url } : {}),
      };
    };
    return { gh, calls: () => calls };
  }

  it("writes an output:refused record, never output:applied, keeping refused and reason but not detail", async () => {
    const cwd = tmp();
    const { gh } = refusingProvider({ times: 1 });
    await firstRun(cwd, reporting(), fakeAgent({ emit: { report: [ISSUE] } }), [gh.skill]);
    const records = readJournal(journalFile(cwd)).records;
    expect(records.some((r) => r.type === "output:applied")).toBe(false);
    const refused = records.find((r) => r.type === "output:refused")!;
    expect(refused).toMatchObject({ node: "report", tool: "github_create_issue" });
    expect(refused.key).toBe(records.find((r) => r.type === "output:intent")!.key);
    expect(refused.output).toEqual({ refused: true, reason: "the tool could not vouch for this write" });
  });

  it("resume does not re-send a refused write: the recorded refusal is replayed and the receipt says refused", async () => {
    const cwd = tmp();
    const { gh, calls } = refusingProvider({ times: 1 });
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    await firstRun(cwd, reporting(), agent, [gh.skill]);
    const { results } = await resumeRun(cwd, reporting(), agent, [gh.skill]);
    expect(calls()).toBe(1);
    expect(gh.issues).toHaveLength(0);
    expect(agent.count("report")).toBe(1);
    expect(results!.get("report")!.status).toBe("failed");
    expect(results!.get("report")!.outputs).toEqual([
      expect.objectContaining({ status: "refused", reason: "the tool could not vouch for this write" }),
    ]);
    expect(readJournal(journalFile(cwd)).records.some((r) => r.type === "output:applied")).toBe(false);
  });

  it("--allow-repeat-writes does not re-send a refusal: its outcome is known, not unconfirmed", async () => {
    const cwd = tmp();
    const { gh, calls } = refusingProvider({ times: 1 });
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    await firstRun(cwd, reporting(), agent, [gh.skill]);
    const { results } = await resumeRun(cwd, reporting(), agent, [gh.skill], { allowRepeatWrites: true });
    expect(calls()).toBe(1);
    expect(results!.get("report")!.outputs).toEqual([expect.objectContaining({ status: "refused" })]);
  });

  it("a refusal that names a write it made is never probed into an applied receipt on resume", async () => {
    const cwd = tmp();
    const { gh, calls } = refusingProvider({ times: 1, transient: true, filesFirst: true });
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    await firstRun(cwd, reporting(), agent, [gh.skill]);
    expect(gh.issues).toHaveLength(1);
    const { results } = await resumeRun(cwd, reporting(), agent, [gh.skill]);
    // The provider holds the marked issue, but the journal says it was refused: no lookup turns it into applied.
    expect(gh.searches()).toBe(0);
    expect(gh.lists()).toBe(0);
    expect(calls()).toBe(1);
    expect(gh.issues).toHaveLength(1);
    expect(results!.get("report")!.outputs).toEqual([
      expect.objectContaining({ status: "refused", ref: 1, url: "https://github.test/acme/api/issues/1" }),
    ]);
  });

  it("a transient refusal that wrote nothing is tried again on resume, as a first send", async () => {
    const cwd = tmp();
    const { gh, calls } = refusingProvider({ times: 1, transient: true });
    const agent = fakeAgent({ emit: { report: [ISSUE] } });
    await firstRun(cwd, reporting(), agent, [gh.skill]);
    expect(gh.issues).toHaveLength(0);
    const { results } = await resumeRun(cwd, reporting(), agent, [gh.skill]);
    // The existing unconfirmed-intent rule: looked up on the provider first, then sent.
    expect(gh.lists()).toBeGreaterThan(0);
    expect(calls()).toBe(2);
    expect(gh.issues).toHaveLength(1);
    expect(results!.get("report")!.outputs).toEqual([expect.objectContaining({ status: "applied", ref: 1 })]);
    const types = readJournal(journalFile(cwd)).records.map((r) => r.type);
    expect(types.filter((t) => t === "output:refused")).toHaveLength(1);
    expect(types.filter((t) => t === "output:applied")).toHaveLength(1);
  });

  // ─── #558 ──

  /** A provider whose create handler files the issue, then refuses once with `shape(filed)`. */
  function refusingAfterFiling(shape: (filed: { number: number; html_url: string }) => Record<string, unknown>) {
    const gh = fakeProvider({ listing: true });
    const create = gh.skill.tools.find((t) => t.name === "github_create_issue")!;
    const real = create.handler;
    let calls = 0;
    create.handler = async (input: unknown, ctx: ToolContext) => {
      calls++;
      const filed = (await real(input, ctx)) as { number: number; html_url: string };
      return calls > 1 ? filed : shape(filed);
    };
    return { gh, calls: () => calls };
  }

  it.each([
    ["in an array", (f: { number: number; html_url: string }) => ({ created: [{ number: f.number }] })],
    ["nested past the slimmed depth", (f: { number: number }) => ({ a: { b: { c: { d: { number: f.number } } } } })],
  ])(
    "a transient refusal that names what it made %s is not retried on resume (decided from the handler's output)",
    async (_l, extra) => {
      const cwd = tmp();
      const { gh, calls } = refusingAfterFiling((filed) => ({
        refused: true,
        reason: "the tool could not vouch for this write",
        transient: true,
        ...extra(filed),
      }));
      const agent = fakeAgent({ emit: { report: [ISSUE] } });
      await firstRun(cwd, reporting(), agent, [gh.skill]);
      expect(gh.issues).toHaveLength(1);
      const refused = readJournal(journalFile(cwd)).records.find((r) => r.type === "output:refused")!;
      expect(refused.retry).toBeUndefined();
      const { results } = await resumeRun(cwd, reporting(), agent, [gh.skill]);
      // Not looked up into an applied receipt, not re-sent: the refusal stands.
      expect(gh.searches()).toBe(0);
      expect(gh.lists()).toBe(0);
      expect(calls()).toBe(1);
      expect(gh.issues).toHaveLength(1);
      expect(results!.get("report")!.outputs).toEqual([expect.objectContaining({ status: "refused" })]);
    },
  );

  it("the retry decision is recorded with the refusal: retry only on a transient one that names nothing", async () => {
    for (const transient of [true, false]) {
      const cwd = tmp();
      const { gh } = refusingProvider({ times: 1, transient });
      await firstRun(cwd, reporting(), fakeAgent({ emit: { report: [ISSUE] } }), [gh.skill]);
      const refused = readJournal(journalFile(cwd)).records.find((r) => r.type === "output:refused")!;
      if (transient) expect(refused.retry).toBe(true);
      else expect(refused.retry).toBeUndefined();
    }
  });

  it("the journal caps a refusal's reason like a receipt, and a refusal with no usable reason gets the fixed wording", async () => {
    for (const [reason, want] of [
      ["r".repeat(5000), "r".repeat(200)],
      [42, "the tool refused the write"],
    ] as const) {
      const cwd = tmp();
      const gh = fakeProvider();
      const create = gh.skill.tools.find((t) => t.name === "github_create_issue")!;
      create.handler = async () => ({ refused: true, reason });
      await firstRun(cwd, reporting(), fakeAgent({ emit: { report: [ISSUE] } }), [gh.skill]);
      const refused = readJournal(journalFile(cwd)).records.find((r) => r.type === "output:refused")!;
      expect(refused.output).toEqual({ refused: true, reason: want });
    }
  });

  it("the resume summary prints refused and transient counts", async () => {
    for (const transient of [false, true]) {
      const cwd = tmp();
      const { gh } = refusingProvider({ times: 1, transient });
      const agent = fakeAgent({ emit: { report: [ISSUE] } });
      await firstRun(cwd, reporting(), agent, [gh.skill]);
      const prepared = prepareResume(RUN_ID, { plan: true }, { cwd, loadWorkflow: () => reporting() });
      const text = prepared.lines.join("\n");
      if (transient) expect(text).toMatch(/report\s+write stage only: .*1 transient refusal\(s\) to try again/);
      else expect(text).toMatch(/report\s+write stage only: .*1 refused write\(s\), not re-sent/);
    }
  });
});

describe("replay keeps every NodeResult field (#581)", () => {
  /** Every field of NodeResult, set. `Required<NodeResult>` makes a new field a type error here. */
  const FULL: Required<NodeResult> = {
    status: "success",
    data: { value: "a-out", nested: { n: 1 } },
    toolCalls: [
      { tool: "github_search_issues", input: { query: "abc" }, output: { items: [] }, status: "success" },
      { tool: "github_create_issue", input: { title: "t" }, status: "error" },
      { tool: "legacy_tool", input: "x" },
    ],
    evals: [
      { name: "has_value", kind: "value", pass: true },
      { name: "judge_it", kind: "judge", pass: false, reasoning: "too vague", score: 0.25 },
    ],
    usage: {
      costUsd: 0.5,
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 7,
      cacheCreationTokens: 3,
      numTurns: 4,
    },
    skippedWrites: ["github_create_issue"],
    harness: { id: "claude-code", version: "2.1.0" },
    degraded: ["sandbox_off"],
    policy: { envScope: true, sandbox: "strict", sandboxStarted: true },
    contained: true,
    outputs: [
      {
        type: "issue",
        via: "github",
        status: "applied",
        reason: "created",
        target: "acme/api",
        ref: 42,
        url: "https://github.test/acme/api/issues/42",
      },
    ],
    budget: { scope: "node", unit: "tokens", limit: 100, spent: 140, kind: "judge" },
  };

  /** What the journal keeps of FULL: tool inputs and outputs are dropped, `contained` is excluded. */
  const KEPT: NodeResult = {
    ...FULL,
    toolCalls: [
      { tool: "github_search_issues", input: null, status: "success" },
      { tool: "github_create_issue", input: null, status: "error" },
      { tool: "legacy_tool", input: null },
    ],
  };
  delete (KEPT as { contained?: boolean }).contained;

  it("every NodeResult field is journaled or excluded with a reason", () => {
    expect(Object.keys(NODE_RESULT_JOURNAL).sort()).toEqual(Object.keys(FULL).sort());
    for (const [field, rule] of Object.entries(NODE_RESULT_JOURNAL)) {
      expect(["verbatim", "reduced", "excluded"], field).toContain(rule.journal);
      if (rule.journal === "excluded") {
        expect((rule as { reason: string }).reason.length, field).toBeGreaterThan(20);
      }
    }
    expect(Object.entries(NODE_RESULT_JOURNAL).filter(([, r]) => r.journal === "excluded")).toHaveLength(1);
    expect(NODE_RESULT_JOURNAL.contained.journal).toBe("excluded");
    expect(NODE_RESULT_JOURNAL.toolCalls.journal).toBe("reduced");
  });

  it("journalResult keeps every journaled field with exact values", () => {
    expect(journalResult(FULL)).toEqual(KEPT);
  });

  it("journalResult adds no key for a field the result does not carry", () => {
    const bare = journalResult({ status: "failed", data: undefined as never, toolCalls: undefined as never });
    expect(bare).toEqual({ status: "failed", data: {}, toolCalls: [] });
    expect(Object.keys(bare).sort()).toEqual(["data", "status", "toolCalls"]);
    // Empty values are still values: an empty degraded list round-trips.
    expect(journalResult({ status: "success", data: {}, toolCalls: [], degraded: [], skippedWrites: [] })).toEqual({
      status: "success",
      data: {},
      toolCalls: [],
      degraded: [],
      skippedWrites: [],
    });
  });

  it("a node:end record and a resume replay carry every journaled field", async () => {
    const cwd = tmp();
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml" });
    journal.begin({
      workflow: chain(),
      input: {},
      sources: {},
      skills: new Map(),
      config: {},
      writeState: createWriteStageState(),
    });
    journal.nodeStart("a", 1);
    journal.nodeEnd("a", 1, FULL, createWriteStageState());
    journal.route("a", "b");
    journal.end("crashed");

    const end = readJournal(journalFile(cwd)).records.find((r) => r.type === "node:end")!;
    expect(end.result).toEqual(KEPT);

    const agent = fakeAgent();
    const { results } = await resumeRun(cwd, chain(), agent);
    expect(results!.get("a")).toEqual(KEPT);
    expect(agent.calls).toEqual(["b", "c", "d"]);
  });

  it("a journal written before these fields were kept still replays", async () => {
    const cwd = tmp();
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml" });
    journal.begin({
      workflow: chain(),
      input: {},
      sources: {},
      skills: new Map(),
      config: {},
      writeState: createWriteStageState(),
    });
    journal.nodeStart("a", 1);
    // The shape the journal wrote before: no policy, no budget.
    journal.nodeEnd(
      "a",
      1,
      { status: "success", data: { value: "a-out" }, toolCalls: [], usage: { costUsd: 0.1 } },
      createWriteStageState(),
    );
    journal.route("a", "b");
    journal.end("crashed");

    const { results } = await resumeRun(cwd, chain(), fakeAgent());
    expect(results!.get("a")).toEqual({
      status: "success",
      data: { value: "a-out" },
      toolCalls: [],
      usage: { costUsd: 0.1 },
    });
  });
});
