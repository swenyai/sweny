import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NodeResult, Workflow } from "../types.js";
import {
  FINAL_OUTPUT_MAX_LINES,
  formatFinalMarkdown,
  formatFinalOutput,
  outputRelPath,
  renderSchemaOutput,
  resolveFinalOutput,
  writeFinalOutput,
} from "./final-output.js";
import { pruneRuns } from "./run-history.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const ok = (data: Record<string, unknown>): NodeResult => ({ status: "success", data, toolCalls: [] });

const answerSchema = {
  type: "object",
  properties: {
    purpose: { type: "string", title: "What it is" },
    how_to_run: { type: "array", title: "How to run it", items: { type: "string" } },
    key_files: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
};

const wf = {
  id: "explain-repo",
  name: "Explain This Repo",
  description: "",
  entry: "survey",
  nodes: {
    survey: { name: "Survey", instruction: "x", skills: [] },
    explain: { name: "Explain It", instruction: "x", skills: [], output: answerSchema },
  },
  edges: [{ from: "survey", to: "explain" }],
} as unknown as Workflow;

describe("renderSchemaOutput", () => {
  it("renders declared fields as key: value with lists, in schema order, skipping empties", () => {
    const lines = renderSchemaOutput(
      {
        risks: [],
        key_files: ["src/main.ts: entry", "README.md: start here"],
        purpose: "A CLI that runs workflows.",
        how_to_run: ["npm install", "npm test"],
        undeclared: "never shown",
      },
      answerSchema,
    );
    expect(lines).toEqual([
      "What it is: A CLI that runs workflows.",
      "How to run it:",
      "- npm install",
      "- npm test",
      "key_files:",
      "- src/main.ts: entry",
      "- README.md: start here",
    ]);
  });

  it("renders arrays of objects and nested objects compactly", () => {
    const lines = renderSchemaOutput(
      {
        findings: [
          { file: "a.ts", severity: "high" },
          { file: "b.ts", severity: "low" },
        ],
        meta: { count: 2, ok: true },
      },
      {
        type: "object",
        properties: {
          findings: { type: "array", items: { type: "object", properties: { file: {}, severity: {} } } },
          meta: { type: "object", properties: { count: {}, ok: {} } },
        },
      },
    );
    expect(lines).toEqual([
      "findings:",
      "- file: a.ts",
      "  severity: high",
      "- file: b.ts",
      "  severity: low",
      "meta:",
      "  count: 2",
      "  ok: true",
    ]);
  });

  it("indents multi-line strings under their key", () => {
    expect(renderSchemaOutput({ notes: "one\ntwo" }, { type: "object", properties: { notes: {} } })).toEqual([
      "notes:",
      "  one",
      "  two",
    ]);
  });

  it("returns nothing when the schema declares no properties", () => {
    expect(renderSchemaOutput({ a: 1 }, { type: "object" })).toEqual([]);
  });
});

describe("resolveFinalOutput", () => {
  it("uses the terminal node's schema fields, not the earlier node's prose", () => {
    const results = new Map<string, NodeResult>([
      ["survey", ok({ summary: "surveyed" })],
      ["explain", ok({ summary: "raw json text", purpose: "Runs workflows.", how_to_run: ["npm test"] })],
    ]);
    const out = resolveFinalOutput(wf, results)!;
    expect(out.kind).toBe("result");
    expect(out.node).toBe("explain");
    expect(out.lines).toEqual(["What it is: Runs workflows.", "How to run it:", "- npm test"]);
  });

  it("falls back to the summary text when the node has no output schema", () => {
    const plain = {
      ...wf,
      nodes: { ...wf.nodes, explain: { name: "Explain It", instruction: "x", skills: [] } },
    } as unknown as Workflow;
    const results = new Map<string, NodeResult>([
      ["survey", ok({ summary: "surveyed" })],
      ["explain", ok({ summary: "It is a CLI.\n\n- fast\n- small" })],
    ]);
    expect(resolveFinalOutput(plain, results)!.lines).toEqual(["It is a CLI.", "", "- fast", "- small"]);
  });

  it("falls back to the summary when the schema fields came back empty", () => {
    const results = new Map<string, NodeResult>([["explain", ok({ summary: "just prose" })]]);
    expect(resolveFinalOutput(wf, results)!.lines).toEqual(["just prose"]);
  });

  it("on failure, shows the failed node's error instead of any result", () => {
    const results = new Map<string, NodeResult>([
      ["survey", ok({ summary: "surveyed" })],
      ["explain", { status: "failed", data: { error: "Claude query timed out after 600000ms" }, toolCalls: [] }],
    ]);
    const out = resolveFinalOutput(wf, results)!;
    expect(out).toMatchObject({ kind: "error", node: "explain", lines: ["Claude query timed out after 600000ms"] });
  });

  it("picks the last-run success when a branch ends on a node that has outgoing edges", () => {
    const looped = {
      ...wf,
      edges: [
        { from: "survey", to: "explain" },
        { from: "explain", to: "survey" },
      ],
    } as unknown as Workflow;
    const results = new Map<string, NodeResult>([
      ["survey", ok({ summary: "first" })],
      ["explain", ok({ summary: "last", purpose: "P" })],
    ]);
    expect(resolveFinalOutput(looped, results)!.node).toBe("explain");
  });

  it("is null when nothing is worth showing", () => {
    expect(resolveFinalOutput(wf, new Map([["survey", ok({})]]))).toBeNull();
    expect(resolveFinalOutput(wf, new Map())).toBeNull();
  });
});

describe("formatFinalOutput", () => {
  const many = (n: number) => ({
    kind: "result" as const,
    node: "explain",
    lines: Array.from({ length: n }, (_, i) => `line ${i + 1}`),
  });

  it("indents and prints everything under the cap", () => {
    expect(formatFinalOutput(many(2))).toBe("  line 1\n  line 2");
  });

  it("caps at 60 lines and points at output.md with the hidden count", () => {
    const text = formatFinalOutput(many(75), { outputPath: ".sweny/runs/20260930-101500-abc123/output.md" });
    const lines = text.split("\n");
    expect(lines).toHaveLength(FINAL_OUTPUT_MAX_LINES + 1);
    expect(lines[59]).toBe("  line 60");
    expect(lines[60]).toBe("  ... (15 more lines, see .sweny/runs/20260930-101500-abc123/output.md)");
  });

  it("drops the pointer when no file was saved (--no-history), and singularizes", () => {
    expect(formatFinalOutput(many(61), { outputPath: null }).split("\n")[60]).toBe("  ... (1 more line)");
  });

  it("exactly at the cap prints no footer", () => {
    expect(formatFinalOutput(many(60))).not.toContain("more line");
  });
});

describe("output.md", () => {
  it("writes the full uncapped answer under .sweny/runs/<id>/", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "final-output-"));
    dirs.push(d);
    const out = { kind: "result" as const, node: "explain", lines: Array.from({ length: 80 }, (_, i) => `l${i}`) };
    const rel = writeFinalOutput("20260930-101500-abc123", formatFinalMarkdown(wf, out), d);
    expect(rel).toBe(".sweny/runs/20260930-101500-abc123/output.md");
    expect(rel).toBe(outputRelPath("20260930-101500-abc123"));
    const body = fs.readFileSync(path.join(d, rel!), "utf-8");
    expect(body.startsWith("# Explain This Repo\n\n")).toBe(true);
    expect(body).toContain("l79");
  });

  it("titles a failure with the node that failed", () => {
    const md = formatFinalMarkdown(wf, { kind: "error", node: "explain", lines: ["boom"] });
    expect(md).toBe("# Explain This Repo: Explain It failed\n\nboom\n");
  });

  it("never throws: an unwritable root returns null", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "final-output-"));
    dirs.push(d);
    const file = path.join(d, "blocker");
    fs.writeFileSync(file, "x");
    expect(writeFinalOutput("20260930-101500-abc123", "x", file)).toBeNull();
  });

  it("is removed with its run when history prunes", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "final-output-"));
    dirs.push(d);
    const id = "20260930-101500-abc123";
    writeFinalOutput(id, "x", d);
    fs.writeFileSync(path.join(d, ".sweny", "runs", `${id}.json`), "{}");
    expect(pruneRuns(d, 0)).toBe(1);
    expect(fs.existsSync(path.join(d, ".sweny", "runs", id))).toBe(false);
  });
});
