import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createVerboseToolObserver } from "../verbose-observer.js";
import type { ExecutionEvent } from "../../types.js";

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

  // ANSI color codes are noise for assertions — strip them.
  function plain(): string {
    return output().replace(/\x1B\[[0-9;]*m/g, "");
  }

  it("prints tool:call input to stderr with the tool name", () => {
    const observe = createVerboseToolObserver();
    const event: ExecutionEvent = {
      type: "tool:call",
      node: "draft",
      tool: "Bash",
      input: { command: "ls -la" },
    };
    observe(event);
    const out = plain();
    expect(out).toContain("Bash");
    expect(out).toContain("(input)");
    expect(out).toContain('"command": "ls -la"');
  });

  it("prints tool:result output to stderr with the tool name", () => {
    const observe = createVerboseToolObserver();
    const event: ExecutionEvent = {
      type: "tool:result",
      node: "draft",
      tool: "Read",
      output: "file contents here",
    };
    observe(event);
    const out = plain();
    expect(out).toContain("Read");
    expect(out).toContain("(output)");
    expect(out).toContain("file contents here");
  });

  it("truncates long payloads and reports how many chars were dropped", () => {
    const observe = createVerboseToolObserver();
    const long = "x".repeat(5_000);
    observe({ type: "tool:result", node: "draft", tool: "Read", output: long });
    const out = plain();
    // Truncation note format: "[3800 more chars]" — exact number isn't load-bearing,
    // but the suffix should be present and the full 5000 chars should not.
    expect(out).toMatch(/\[\d+ more chars\]/);
    expect(out.length).toBeLessThan(long.length);
  });

  it("survives circular references in tool input/output without throwing", () => {
    const observe = createVerboseToolObserver();
    type Cyc = { name: string; self?: unknown };
    const circular: Cyc = { name: "loop" };
    circular.self = circular;

    expect(() => observe({ type: "tool:call", node: "draft", tool: "X", input: circular })).not.toThrow();
    expect(() => observe({ type: "tool:result", node: "draft", tool: "X", output: circular })).not.toThrow();

    // Should fall back to a string representation, not blow up the stream.
    expect(plain()).toContain("X");
  });

  it("renders null and undefined as readable tokens", () => {
    const observe = createVerboseToolObserver();
    observe({ type: "tool:call", node: "draft", tool: "X", input: null });
    observe({ type: "tool:result", node: "draft", tool: "X", output: undefined });
    const out = plain();
    expect(out).toContain("null");
    expect(out).toContain("undefined");
  });

  it("ignores non-tool events", () => {
    const observe = createVerboseToolObserver();
    observe({ type: "node:enter", node: "draft", instruction: "do a thing" });
    observe({ type: "node:exit", node: "draft", result: { status: "success", data: {}, toolCalls: [] } });
    observe({ type: "workflow:start", workflow: "wf" });
    observe({ type: "workflow:end", results: {} });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
