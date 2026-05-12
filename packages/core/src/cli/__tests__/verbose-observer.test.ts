import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createVerboseToolObserver } from "../verbose-observer.js";
import type { ExecutionEvent, ToolCall } from "../../types.js";

describe("createVerboseToolObserver", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  function output(): string {
    return writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
  }

  // ANSI color codes are noise for assertions; strip them.
  function plain(): string {
    return output().replace(/\x1B\[[0-9;]*m/g, "");
  }

  function nodeExit(node: string, toolCalls: ToolCall[]): ExecutionEvent {
    return {
      type: "node:exit",
      node,
      result: { status: "success", data: {}, toolCalls },
    };
  }

  it("prints each tool call's input and output on node:exit", () => {
    const observe = createVerboseToolObserver();
    observe(
      nodeExit("draft", [
        { tool: "Bash", input: { command: "ls -la" }, output: "file1\nfile2\n", status: "success" },
        { tool: "Read", input: { path: "/etc/hosts" }, output: "127.0.0.1 localhost", status: "success" },
      ]),
    );
    const out = plain();
    expect(out).toContain("draft: 2 tool calls");
    expect(out).toContain("Bash");
    expect(out).toContain('"command": "ls -la"');
    expect(out).toContain("file1");
    expect(out).toContain("Read");
    expect(out).toContain("/etc/hosts");
  });

  it("flags error outputs distinctly", () => {
    const observe = createVerboseToolObserver();
    observe(
      nodeExit("guardrails", [{ tool: "Bash", input: { command: "bad" }, output: { error: "boom" }, status: "error" }]),
    );
    expect(plain()).toContain("(output, error)");
  });

  it("truncates long payloads and reports how many chars were dropped", () => {
    const observe = createVerboseToolObserver();
    const long = "x".repeat(5_000);
    observe(nodeExit("draft", [{ tool: "Read", input: { path: "/big" }, output: long, status: "success" }]));
    const out = plain();
    expect(out).toMatch(/\[\d+ more chars\]/);
    expect(out.length).toBeLessThan(long.length);
  });

  it("survives circular references in tool input/output without throwing", () => {
    const observe = createVerboseToolObserver();
    type Cyc = { name: string; self?: unknown };
    const circular: Cyc = { name: "loop" };
    circular.self = circular;

    expect(() => observe(nodeExit("draft", [{ tool: "X", input: circular, output: circular }]))).not.toThrow();
    expect(plain()).toContain("X");
  });

  it("renders null and undefined as readable tokens", () => {
    const observe = createVerboseToolObserver();
    observe(nodeExit("draft", [{ tool: "X", input: null, output: undefined }]));
    const out = plain();
    expect(out).toContain("null");
    expect(out).toContain("undefined");
  });

  it("is silent for nodes that made no tool calls", () => {
    const observe = createVerboseToolObserver();
    observe(nodeExit("analyze", []));
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("ignores non-node:exit events", () => {
    const observe = createVerboseToolObserver();
    observe({ type: "node:enter", node: "draft", instruction: "do a thing" });
    observe({ type: "workflow:start", workflow: "wf" });
    observe({ type: "workflow:end", results: {} });
    observe({ type: "tool:call", node: "draft", tool: "Read", input: {} });
    observe({ type: "tool:result", node: "draft", tool: "Read", output: "x" });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
