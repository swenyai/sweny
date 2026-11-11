import { describe, it, expect, afterEach } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
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
function crashedRun(input: Record<string, unknown>, env: Record<string, string> = {}, workflow: Workflow = wf): string {
  const cwd = mkdtempSync(join(tmpdir(), "sweny-resume-"));
  dirs.push(cwd);
  const j = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "w.yml", env });
  j.begin({
    workflow,
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

  it("a state dir that resolves inside the workspace is refused before anything is read", () => {
    const cwd = crashedRun({});
    const inside = join(cwd, ".state");
    mkdirSync(inside, { recursive: true });
    const r = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => wf, stateRoot: inside });
    expect(!r.ok && r.error).toMatch(/resolves inside the workspace/);
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

/**
 * Rewrite a run's journal as a sweny before spec v3 wrote it (#575): no
 * `spec_version` on run:start, an older `sweny_version`, every record re-chained
 * and the head re-signed under the run's own key.
 */
function asPreV3Journal(cwd: string, swenyVersion: string): void {
  const dir = journalDir(cwd, RUN_ID);
  const file = join(dir, JOURNAL_FILE);
  const key = Buffer.from(readFileSync(join(dir, "key"), "utf-8").trim(), "hex");
  const mac = (s: string) => createHmac("sha256", key).update(s).digest("hex");
  let prev = "";
  const out: Record<string, unknown>[] = [];
  for (const line of readFileSync(file, "utf-8").trim().split("\n")) {
    const { h: _h, ...body } = JSON.parse(line) as Record<string, unknown>;
    if (body.type === "run:start") {
      delete body.spec_version;
      body.sweny_version = swenyVersion;
    }
    const h = mac(`sweny-journal\n${RUN_ID}\n${String(body.seq)}\n${prev}\n${JSON.stringify(body)}`);
    out.push({ ...body, h });
    prev = h;
  }
  writeFileSync(file, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const head = { v: 1, run_id: RUN_ID, seq: out.length, record: out[out.length - 1] };
  writeFileSync(
    join(dir, "head.json"),
    JSON.stringify({ ...head, h: mac(`sweny-journal-head\n${JSON.stringify(head)}`) }) + "\n",
  );
}

describe("a run journaled before spec v3 (#575)", () => {
  it("is refused with both versions and the command that resumes it, before the workflow hash check", () => {
    // The old sweny hashed the workflow as spec_version 2; this one loads the same file as 3.
    const cwd = crashedRun({}, {}, { ...wf, spec_version: "2" });
    asPreV3Journal(cwd, "0.1.215");
    for (const force of [false, true]) {
      const r = prepareResume(
        RUN_ID,
        { force },
        { cwd, loadWorkflow: () => ({ ...wf, spec_version: "3" }), swenyVersion: "0.2.0" },
      );
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toBe(
        `run ${RUN_ID} was journaled by sweny 0.1.215, before spec_version "3"; this sweny (0.2.0) runs the ` +
          `workflow as spec_version "3" and cannot resume it. Resume it with the sweny that started it: ` +
          `npx @sweny-ai/core@0.1.215 workflow resume ${RUN_ID}`,
      );
    }
  });

  it("a v3 journal of the same run still resumes", () => {
    const cwd = crashedRun({}, {}, { ...wf, spec_version: "3" });
    const r = prepareResume(
      RUN_ID,
      {},
      { cwd, loadWorkflow: () => ({ ...wf, spec_version: "3" }), swenyVersion: "0.2.0" },
    );
    expect(r.ok && "ctx" in r).toBe(true);
    if (r.ok && "ctx" in r) r.ctx.journal.end("crashed");
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
