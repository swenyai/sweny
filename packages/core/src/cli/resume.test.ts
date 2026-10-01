import { describe, it, expect, afterEach } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JOURNAL_FILE, RunJournal, journalDir } from "../journal.js";
import { createWriteStageState } from "../safe-outputs.js";
import { journalDisabled, prepareResume } from "./resume.js";
import type { Workflow } from "../types.js";

// Run keys go to a scratch state dir, never the real ~/.local/state.
process.env.SWENY_STATE_DIR = mkdtempSync(join(tmpdir(), "sweny-state-"));

const RUN_ID = "20260930-130000-0d0e0f";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const wf: Workflow = {
  id: "w",
  name: "W",
  description: "",
  entry: "a",
  nodes: { a: { name: "A", instruction: "do a", skills: [] }, b: { name: "B", instruction: "do b", skills: [] } },
  edges: [{ from: "a", to: "b" }],
};

/** A journal killed after node `a` finished and routed to `b`. */
function crashedRun(input: Record<string, unknown>, env: Record<string, string> = {}): string {
  const cwd = mkdtempSync(join(tmpdir(), "sweny-resume-"));
  dirs.push(cwd);
  const j = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "w.yml", env });
  j.begin({
    workflow: wf,
    input,
    sources: {},
    skills: new Map(),
    config: {},
    writeState: createWriteStageState(),
  });
  j.nodeStart("a", 1);
  j.nodeEnd("a", 1, { status: "success", data: {}, toolCalls: [] }, createWriteStageState());
  j.route("a", "b");
  j.end("crashed");
  return cwd;
}

describe("prepareResume", () => {
  it("resolves a unique run id prefix and resumes with the journaled input", () => {
    const cwd = crashedRun({ repo: "acme/api" });
    const r = prepareResume("20260930-1300", {}, { cwd, loadWorkflow: () => wf });
    expect(r.ok && "ctx" in r && r.ctx.input).toEqual({ repo: "acme/api" });
    if (r.ok && "ctx" in r) r.ctx.journal.end("crashed");
  });

  it("an unknown run id says why runs may have no journal", () => {
    const cwd = crashedRun({});
    const r = prepareResume("nope", {}, { cwd, loadWorkflow: () => wf });
    expect(!r.ok && r.error).toMatch(/no run journal matches "nope".*--no-journal/);
  });

  it("--plan prints the plan and leaves a torn journal as it is", () => {
    const cwd = crashedRun({});
    const file = join(journalDir(cwd, RUN_ID), JOURNAL_FILE);
    appendFileSync(file, '{"v":1,"seq"');
    const before = readFileSync(file, "utf-8");
    const r = prepareResume(RUN_ID, { plan: true }, { cwd, loadWorkflow: () => wf });
    expect(r.ok && "planOnly" in r).toBe(true);
    expect(r.lines.join("\n")).toMatch(/resuming drops it/);
    expect(r.lines.join("\n")).toMatch(/✓ a\s+replay from journal \(success\)/);
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  it("an input the journal redacted must be passed again, and must match", () => {
    const cwd = crashedRun({ api_token: "tok-1234567890" });
    const missing = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => wf });
    expect(!missing.ok && missing.error).toMatch(/pass the same --input again/);

    const wrong = prepareResume(RUN_ID, { input: '{"api_token":"other-value-123"}' }, { cwd, loadWorkflow: () => wf });
    expect(!wrong.ok && wrong.error).toMatch(/--input differs from the run's original input/);

    const right = prepareResume(RUN_ID, { input: '{"api_token":"tok-1234567890"}' }, { cwd, loadWorkflow: () => wf });
    expect(right.ok && "ctx" in right && right.ctx.input).toEqual({ api_token: "tok-1234567890" });
    if (right.ok && "ctx" in right) right.ctx.journal.end("crashed");
  });

  it("the workflow file the journal recorded is used unless --workflow overrides it", () => {
    const cwd = crashedRun({});
    const seen: string[] = [];
    const loadWorkflow = (f: string) => {
      seen.push(f);
      return wf;
    };
    prepareResume(RUN_ID, { plan: true }, { cwd, loadWorkflow });
    prepareResume(RUN_ID, { plan: true, workflow: "moved.yml" }, { cwd, loadWorkflow });
    expect(seen).toEqual(["w.yml", "moved.yml"]);
  });
});

describe("journalDisabled", () => {
  it("is off with --no-journal or journal: off", () => {
    expect(journalDisabled(false, undefined)).toBe(true);
    expect(journalDisabled(undefined, "off")).toBe(true);
    expect(journalDisabled(true, undefined)).toBe(false);
    expect(journalDisabled(undefined, "on")).toBe(false);
  });
});
