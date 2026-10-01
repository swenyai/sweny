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
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
import type { Claude, NodeResult, Skill, Workflow } from "../types.js";

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
  } = {},
) {
  const calls: string[] = [];
  const claude: Claude = {
    async run(req) {
      const node = /NODE:(\w+)/.exec(req.instruction)![1];
      calls.push(node);
      if (opts.kill?.(node, calls.filter((c) => c === node).length)) throw new Kill(`agent ${node}`);
      const emitter = req.tools.find((t) => t.name === "emit_output");
      for (const e of opts.emit?.[node] ?? []) await emitter!.handler(e, { config: {}, logger: silent });
      const nth = calls.filter((c) => c === node).length;
      const data = opts.data?.(node, nth) ?? { value: `${node}-out` };
      return { status: "success", data, toolCalls: [] } as NodeResult;
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

/** A GitHub-shaped provider: issues live in memory, search finds a token in the body. */
function fakeProvider(opts: { searchFails?: boolean } = {}) {
  const issues: { number: number; title: string; body: string; html_url: string }[] = [];
  let searches = 0;
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
          };
          issues.push(issue);
          return issue;
        },
      },
    ],
  };
  return { skill, issues, searches: () => searches };
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
    if (err instanceof Kill) return true;
    throw err;
  }
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
  const { results } = await execute(workflow, prepared.ctx.input, {
    ...execOpts(agent, skills, cwd),
    journal: prepared.ctx.journal,
  });
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
