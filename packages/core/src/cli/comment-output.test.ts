import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NodeResult, Workflow } from "../types.js";
import { summarizeRun } from "./run-output.js";
import {
  formatCrashComment,
  formatRunComment,
  runCommentMarker,
  writeRunComment,
  RUN_COMMENT_FOOTER,
} from "./comment-output.js";

const workflow = {
  id: "pr-review",
  name: "PR Review",
  description: "",
  entry: "gather",
  nodes: {
    gather: { name: "Gather", instruction: "SECRET PROMPT TEXT", skills: [] },
    analyze: { name: "Analyze", instruction: "SECRET PROMPT TEXT", skills: [] },
    report: { name: "Report", instruction: "SECRET PROMPT TEXT", skills: [] },
  },
  edges: [
    { from: "gather", to: "analyze" },
    { from: "analyze", to: "report" },
  ],
} as Workflow;

const call = (tool: string) => ({ tool, input: { q: "SECRET INPUT" } });
const ok = (n = 0): NodeResult => ({
  status: "success",
  data: { summary: "SECRET MODEL PROSE" },
  toolCalls: Array.from({ length: n }, () => call("t")),
  usage: { inputTokens: 1000, outputTokens: 500, costUsd: 0.05 },
});
const durations = { gather: 4_000, analyze: 65_000, report: 900 };

describe("formatRunComment", () => {
  it("success", () => {
    const results = new Map<string, NodeResult>([
      ["gather", ok(5)],
      ["analyze", ok(9)],
      ["report", ok(2)],
    ]);
    const md = formatRunComment(workflow, results, summarizeRun(results, 70_000), { durationsMs: durations });
    expect(md).toMatchSnapshot();
  });

  it("failure", () => {
    const results = new Map<string, NodeResult>([
      ["gather", ok(5)],
      ["analyze", { status: "failed", data: { error: "SECRET MODEL PROSE" }, toolCalls: [call("t")] }],
    ]);
    const md = formatRunComment(workflow, results, summarizeRun(results, 12_000), { durationsMs: durations });
    expect(md).toMatchSnapshot();
  });

  it("skipped", () => {
    const results = new Map<string, NodeResult>([
      ["gather", ok(1)],
      ["analyze", { status: "skipped", data: {}, toolCalls: [] }],
      ["report", { status: "skipped", data: {}, toolCalls: [] }],
    ]);
    const md = formatRunComment(workflow, results, summarizeRun(results, 3_000));
    expect(md).toMatchSnapshot();
  });

  it("leads with the marker, carries the footer, and leaks no prompts or model prose", () => {
    const results = new Map<string, NodeResult>([
      ["gather", ok(5)],
      ["analyze", { status: "failed", data: { error: "SECRET MODEL PROSE" }, toolCalls: [call("t")] }],
    ]);
    const md = formatRunComment(workflow, results, summarizeRun(results, 1000));
    expect(md.split("\n")[0]).toBe("<!-- sweny-run-comment:pr-review -->");
    expect(md).toContain(RUN_COMMENT_FOOTER);
    expect(RUN_COMMENT_FOOTER).toBe("Run with [SWEny](https://github.com/swenyai/sweny): `npx @sweny-ai/core new`");
    expect(md).not.toContain("SECRET");
    expect(md).not.toContain("indigo");
    expect(md).not.toContain("\u2014");
    expect(md).toContain("#2563eb");
  });

  it("marker id is comment-safe", () => {
    expect(runCommentMarker("a--b>c d")).toBe("<!-- sweny-run-comment:a-b_c_d -->");
  });

  it("escapes table-breaking node names", () => {
    const wf = {
      ...workflow,
      nodes: { gather: { name: "A | B\nC", instruction: "", skills: [] } },
      edges: [],
      entry: "gather",
    } as Workflow;
    const results = new Map<string, NodeResult>([["gather", ok()]]);
    const md = formatRunComment(wf, results, summarizeRun(results, 1));
    expect(md).toContain("A \\| B C");
  });
});

describe("writeRunComment", () => {
  it("writes the file, creating parent dirs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-comment-"));
    const file = path.join(dir, "nested", "c.md");
    const results = new Map<string, NodeResult>([["gather", ok()]]);
    expect(writeRunComment(file, workflow, results, summarizeRun(results, 1))).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain("sweny-run-comment:pr-review");
  });
  it("never throws", () => {
    const results = new Map<string, NodeResult>([["gather", ok()]]);
    expect(writeRunComment("/dev/null/x/c.md", workflow, results, summarizeRun(results, 1))).toBe(false);
  });
});

describe("CLI flag", () => {
  it("workflow run exposes --comment-file <path>", async () => {
    const { WORKFLOW_RUN_OPTIONS } = await import("./run-output.js");
    const flag = WORKFLOW_RUN_OPTIONS.find(([f]) => f.startsWith("--comment-file"));
    expect(flag?.[0]).toBe("--comment-file <path>");
  });
});

describe("formatCrashComment", () => {
  it("crash: receipt only, no DAG, no error text", () => {
    const md = formatCrashComment(workflow, summarizeRun(new Map(), 2_000, true));
    expect(md).toMatchSnapshot();
    expect(md).not.toContain("mermaid");
    expect(md.split("\n")[0]).toBe("<!-- sweny-run-comment:pr-review -->");
  });
});
