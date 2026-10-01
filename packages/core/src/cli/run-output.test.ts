import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NodeResult, Workflow } from "../types.js";
import {
  createRunLogger,
  formatCost,
  formatReceipt,
  formatReceiptDuration,
  formatStepSummary,
  formatTokenCount,
  renderReceiptLine,
  summarizeRun,
  writeStepSummary,
  WORKFLOW_RUN_DESCRIPTION,
  WORKFLOW_RUN_OPTIONS,
} from "./run-output.js";

const call = (tool: string) => ({ tool, input: {} });

function ok(toolCalls = 0, usage?: NodeResult["usage"]): NodeResult {
  return { status: "success", data: {}, toolCalls: Array.from({ length: toolCalls }, () => call("t")), usage };
}

const workflow: Workflow = {
  id: "demo",
  name: "Demo Flow",
  description: "",
  entry: "a",
  nodes: {
    a: { name: "Fetch", instruction: "x", skills: [] },
    b: { name: "Analyze", instruction: "x", skills: [] },
    c: { name: "Report", instruction: "x", skills: [] },
  },
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
} as Workflow;

describe("formatters", () => {
  it("formats durations", () => {
    expect(formatReceiptDuration(420)).toBe("420ms");
    expect(formatReceiptDuration(41_000)).toBe("41s");
    expect(formatReceiptDuration(130_000)).toBe("2m10s");
    expect(formatReceiptDuration(65_000)).toBe("1m05s");
  });
  it("formats tokens and cost", () => {
    expect(formatTokenCount(843)).toBe("843");
    expect(formatTokenCount(1234)).toBe("1.2k");
    expect(formatTokenCount(12_000)).toBe("12k");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
    expect(formatCost(0.18)).toBe("$0.18");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(0)).toBe("$0.00");
  });
});

describe("receipt", () => {
  it("success with tokens and cost", () => {
    const results = new Map<string, NodeResult>([
      ["a", ok(20, { inputTokens: 5000, outputTokens: 1000, costUsd: 0.08 })],
      ["b", ok(11, { inputTokens: 3000, outputTokens: 1000, costUsd: 0.06 })],
      ["c", ok(10, { inputTokens: 1500, outputTokens: 500, costUsd: 0.04 })],
    ]);
    const line = formatReceipt(summarizeRun(results, 130_000));
    expect(line).toBe("✓ 3/3 nodes · 41 tool calls · 2m10s · 12k tokens · $0.18");
  });

  it("names a non-Claude harness and what it could not honor natively (#331)", () => {
    const codex = (degraded: string[]): NodeResult => ({
      ...ok(2, { inputTokens: 900, outputTokens: 100 }),
      harness: { id: "codex", version: "0.159.2" },
      degraded,
    });
    const results = new Map<string, NodeResult>([
      [
        "a",
        codex(["deny [write, edit]: harness can only deny [shell, net, subagent]", "max_turns: no native turn limit"]),
      ],
      ["b", codex(["max_turns: no native turn limit"])],
    ]);
    const s = summarizeRun(results, 5_000);
    expect(s.harness).toBe("codex");
    expect(s.degraded).toEqual(["deny [write, edit]", "max_turns"]);
    expect(formatReceipt(s)).toBe(
      "✓ 2/2 nodes · 4 tool calls · 5s · 2k tokens · codex · degraded: deny [write, edit], max_turns",
    );
  });

  it("stays unchanged for Claude Code, which never degrades", () => {
    const results = new Map<string, NodeResult>([
      ["a", { ...ok(1), harness: { id: "claude-code", version: "0.3.0" }, degraded: [] }],
    ]);
    expect(formatReceipt(summarizeRun(results, 1_000))).toBe("✓ 1/1 nodes · 1 tool call · 1s");
  });

  it("failure shows the cross and the partial count", () => {
    const results = new Map<string, NodeResult>([
      ["a", ok(3, { inputTokens: 900, outputTokens: 100, costUsd: 0.01 })],
      ["b", { status: "failed", data: { error: "secret prose" }, toolCalls: [call("t")] }],
    ]);
    const s = summarizeRun(results, 12_000);
    expect(s.ok).toBe(false);
    expect(formatReceipt(s)).toBe("✗ 1/2 nodes · 4 tool calls · 12s · 1k tokens · $0.01");
  });

  it("omits cost (never estimates) when the SDK reported none", () => {
    const results = new Map<string, NodeResult>([
      ["a", ok(1, { inputTokens: 2000, outputTokens: 500 })],
      ["b", ok(0)],
    ]);
    const line = formatReceipt(summarizeRun(results, 5000));
    expect(line).toBe("✓ 2/2 nodes · 1 tool call · 5s · 2.5k tokens");
    expect(line).not.toContain("$");
  });

  it("omits tokens and cost when no node reported usage", () => {
    const line = formatReceipt(summarizeRun(new Map([["a", ok(2)]]), 900));
    expect(line).toBe("✓ 1/1 nodes · 2 tool calls · 900ms");
  });

  it("notes skipped nodes and does not fail on them", () => {
    const results = new Map<string, NodeResult>([
      ["a", ok(0)],
      ["b", { status: "skipped", data: {}, toolCalls: [] }],
    ]);
    const s = summarizeRun(results, 1000);
    expect(s.ok).toBe(true);
    expect(formatReceipt(s)).toBe("✓ 1/2 nodes · 1 skipped · 0 tool calls · 1s");
  });

  it("a crashed run is a failure even with no results", () => {
    expect(formatReceipt(summarizeRun(new Map(), 1000, true)).startsWith("✗ 0/0 nodes")).toBe(true);
  });

  it("non-TTY output has no ANSI codes", () => {
    const s = summarizeRun(new Map([["a", ok(1)]]), 1000);
    expect(renderReceiptLine(s, false)).not.toMatch(/\x1B/);
    expect(renderReceiptLine(s, false)).toBe(formatReceipt(s));
  });

  it("carries metadata only: no node data or tool payloads", () => {
    const results = new Map<string, NodeResult>([
      [
        "a",
        {
          status: "success",
          data: { answer: "TOP-SECRET-PROSE" },
          toolCalls: [{ tool: "Bash", input: { cmd: "TOP-SECRET-INPUT" }, output: "TOP-SECRET-OUT" }],
        },
      ],
    ]);
    const s = summarizeRun(results, 1000);
    const blob = JSON.stringify(s) + formatReceipt(s) + formatStepSummary(workflow, results, s);
    expect(blob).not.toContain("TOP-SECRET");
  });
});

describe("usage aggregation from mocked SDK result messages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function runNodes(messages: Array<Record<string, unknown>>): Promise<Map<string, NodeResult>> {
    const queue = [...messages];
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn().mockImplementation(() =>
        (async function* () {
          yield queue.shift();
        })(),
      ),
      createSdkMcpServer: vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" }),
      tool: vi.fn(),
    }));
    const { ClaudeClient } = await import("../claude.js");
    const client = new ClaudeClient();
    const results = new Map<string, NodeResult>();
    for (let i = 0; i < messages.length; i++) {
      results.set(`n${i}`, await client.run({ instruction: "x", context: {}, tools: [] }));
    }
    return results;
  }

  it("sums tokens and cost across nodes", async () => {
    const results = await runNodes([
      {
        type: "result",
        subtype: "success",
        result: "a",
        total_cost_usd: 0.1,
        usage: { input_tokens: 4000, output_tokens: 1000, cache_read_input_tokens: 99999 },
      },
      {
        type: "result",
        subtype: "success",
        result: "b",
        total_cost_usd: 0.05,
        usage: { input_tokens: 6000, output_tokens: 1000 },
      },
    ]);
    const s = summarizeRun(results, 10_000);
    expect(s.tokens).toBe(12_000); // input + output, cache reads excluded
    expect(s.costUsd).toBeCloseTo(0.15);
  });

  it("leaves cost out when the SDK result has none", async () => {
    const results = await runNodes([
      { type: "result", subtype: "success", result: "a", usage: { input_tokens: 10, output_tokens: 5 } },
      { type: "result", subtype: "success", result: "b" },
    ]);
    const s = summarizeRun(results, 1000);
    expect(s.tokens).toBe(15);
    expect(s.costUsd).toBeUndefined();
  });
});

describe("step summary", () => {
  const results = new Map<string, NodeResult>([
    ["a", ok(1)],
    ["b", { status: "failed", data: {}, toolCalls: [] }],
    ["c", { status: "skipped", data: {}, toolCalls: [] }],
  ]);
  const summary = summarizeRun(results, 3000);

  it("contains the receipt and a status-colored Mermaid DAG in brand blue, not indigo", () => {
    const md = formatStepSummary(workflow, results, summary);
    expect(md).toContain("## ❌ Demo Flow");
    expect(md).toContain(formatReceipt(summary));
    expect(md).toContain("```mermaid");
    expect(md).toMatch(/classDef success fill:#2563eb/);
    expect(md).toMatch(/classDef failed /);
    expect(md).toMatch(/classDef skipped /);
    expect(md).toMatch(/class a success/);
    expect(md).toMatch(/class b failed/);
    expect(md).toMatch(/class c skipped/);
    expect(md).not.toMatch(/indigo|#6366f1|#4f46e5/i);
    expect(md).not.toContain("—");
  });

  it("appends to the file when GITHUB_STEP_SUMMARY is set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-summary-"));
    const file = path.join(dir, "summary.md");
    fs.writeFileSync(file, "existing\n");
    expect(writeStepSummary(workflow, results, summary, undefined, { GITHUB_STEP_SUMMARY: file })).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    expect(text.startsWith("existing\n")).toBe(true);
    expect(text).toContain("graph TB");
    fs.rmSync(dir, { recursive: true });
  });

  it("writes nothing when GITHUB_STEP_SUMMARY is unset or empty", () => {
    const spy = vi.spyOn(fs, "appendFileSync");
    expect(writeStepSummary(workflow, results, summary, undefined, {})).toBe(false);
    expect(writeStepSummary(workflow, results, summary, undefined, { GITHUB_STEP_SUMMARY: "" })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never throws when the file cannot be written", () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const bad = path.join(os.tmpdir(), "sweny-no-such-dir-383", "x.md");
    expect(writeStepSummary(workflow, results, summary, undefined, { GITHUB_STEP_SUMMARY: bad })).toBe(false);
    expect(err.mock.calls.join("")).toContain("could not write GITHUB_STEP_SUMMARY");
    err.mockRestore();
  });
});

describe("run logger: verbose vs default", () => {
  const strip = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, "");

  it("default: info/debug are dropped, warnings and errors are rendered", () => {
    const out: string[] = [];
    const log = createRunLogger({ verbose: false, tty: false, write: (s) => out.push(s) });
    log.info("→ Fetch", { node: "a" });
    log.debug("auth mode: auto");
    log.warn("  requires skipped: github", { node: "a" });
    log.error("boom");
    expect(out.map(strip)).toEqual(["  ⚠ requires skipped: github\n", "  ✗ boom\n"]);
    expect(out.join("")).not.toMatch(/\[(info|debug|warn|error)\]/);
  });

  it("default on a TTY: warnings are held until flush so the live node line is not clobbered", () => {
    const out: string[] = [];
    const log = createRunLogger({ verbose: false, tty: true, write: (s) => out.push(s) });
    log.warn("careful");
    expect(out).toEqual([]);
    log.flush();
    expect(out.map(strip)).toEqual(["  ⚠ careful\n"]);
    log.flush();
    expect(out).toHaveLength(1);
  });

  it("verbose: raw logger lines pass through", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const dbgSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = createRunLogger({ verbose: true, tty: false });
    log.info("→ Fetch", { node: "a" });
    log.debug("auth mode: auto");
    expect(logSpy).toHaveBeenCalledWith("[info] → Fetch", { node: "a" });
    expect(dbgSpy).toHaveBeenCalledWith("[debug] auth mode: auto", "");
    logSpy.mockRestore();
    dbgSpy.mockRestore();
  });
});

describe("workflow run help text", () => {
  const text = [WORKFLOW_RUN_DESCRIPTION, ...WORKFLOW_RUN_OPTIONS.flatMap(([f, d]) => [f, d])].join("\n");

  it("has no internal history and no em-dashes", () => {
    expect(text).not.toMatch(/behavior changed|pre-Fix|Fix #6|in this release|Replaces the/i);
    expect(text).not.toContain("—");
    expect(text).not.toContain("DEFAULT_MAX_STEPS");
  });

  it("matches the snapshot", () => {
    expect(WORKFLOW_RUN_OPTIONS.map(([f, d]) => `${f}  ${d}`)).toMatchInlineSnapshot(`
      [
        "--timeout <ms>  Whole-run wall-clock timeout in ms. Applies to batch runs (.sweny/e2e/) and to a single workflow file (default: 3600000 = 60 min; 0 = no wall-clock budget)",
        "--max-steps <n>  Hard cap on total node executions for a single workflow file, including eval-failure retries (default: 200)",
        "--max-tokens <n>  Run-wide token budget (input plus output) for a single workflow file. The lowest of this and the workflow's budget.tokens wins. A crossing stops the agent, fails the node and halts the run",
        "--max-cost <usd>  Run-wide cost budget in US dollars for a single workflow file, from harness-reported cost (never estimated). The lowest of this and the workflow's budget.cost_usd wins",
        "-y, --yes  Skip the batch confirmation prompt (for CI)",
        "--dry-run  Run with read-only tools only: write tools, external MCP servers, and shell/file-edit tools are withheld, so nothing is created, posted, or sent. Stops at the first natural-language conditional edge. To inspect nodes without running, use --list-nodes.",
        "--stage  Run normally, but preview every safe output (nodes with outputs:) instead of writing it: print what would be written and write nothing",
        "--list-nodes  Validate, print nodes and skills, and exit without running",
        "--json  Output result as JSON on stdout; suppress progress output",
        "--stream  Stream NDJSON events to stdout (for Studio / automation)",
        "--verbose  Show raw log lines and each tool call's input and output inline (human-readable, truncated). Use --stream for full untruncated NDJSON.",
        "--mermaid  Output a Mermaid diagram with execution state after run",
        "--comment-file <path>  Write a PR-comment markdown (run receipt, status-colored DAG, per-node table; metadata only) to <path> so any CI can post it",
        "--input <json>  JSON string of input data to pass to the workflow",
        "--agent <id>  Coding agent that runs the nodes: claude (default), codex, or pi (experimental)",
        "--harness-policy <mode>  strict: refuse a node whose policy the agent cannot enforce; warn: run it and report what was not enforced (default: strict under GitHub Actions, warn elsewhere; env SWENY_HARNESS_POLICY)",
      ]
    `);
  });
});
