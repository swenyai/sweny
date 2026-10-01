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
import { describe, it, expect, afterEach } from "vitest";
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
import { spawnSync } from "node:child_process";
import { execute } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import {
  JOURNAL_FILE,
  JournalMismatchError,
  RunJournal,
  journalDir,
  markerToken,
  readJournal,
  type JournalFaults,
  type JournalRecord,
} from "../journal.js";
import { prepareResume, type ResumeOptions } from "../cli/resume.js";
import { createWriteStageState } from "../safe-outputs.js";
import type { Claude, NodeResult, NodeUsage, Skill, Workflow } from "../types.js";

// Run keys go to a scratch state dir, never the real ~/.local/state.
process.env.SWENY_STATE_DIR = mkdtempSync(join(tmpdir(), "sweny-state-"));

const RUN_ID = "20260930-120000-abc123";
const silent = { info() {}, warn() {}, error() {}, debug() {} };

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
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(lock, JSON.stringify({ pid: dead, started: 0, nonce: "dead" }));
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
  it("throttled live usage is written when the window ends: 10 then 100 within it, crash after it, resume seeds 100", async () => {
    const cwd = tmp();
    const claude: Claude = {
      async run(req) {
        req.onUsage?.({ inputTokens: 10, outputTokens: 0 });
        req.onUsage?.({ inputTokens: 100, outputTokens: 0 });
        await new Promise((r) => setTimeout(r, 300));
        throw new Kill("process died after the throttle window");
      },
      async evaluate() {
        throw new Error("unused");
      },
      async ask() {
        return "ALLOW";
      },
    };
    const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "wf.yml", usageIntervalMs: 50 });
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
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(join(journalDir(cwd, RUN_ID), "lock"), JSON.stringify({ pid: dead, started: 0, nonce: "x" }));
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
