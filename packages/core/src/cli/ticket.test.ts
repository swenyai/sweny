import { describe, it, expect, vi, afterEach } from "vitest";
import type { NodeResult } from "../types.js";
import { formatReceipt, summarizeRun } from "./run-output.js";
import { createPaint } from "./style.js";
import {
  STAMP_DELAY_MS,
  TICKET_MAX_WIDTH,
  TICKET_MIN_WIDTH,
  formatTicketText,
  renderTicket,
  shortRunId,
  stampWords,
  ticketWidth,
  writeReceipt,
  type TicketData,
} from "./ticket.js";

const RUN = "20260930-110000-3f9a2c";
const SCOPED = { envScope: true, sandbox: "auto", sandboxStarted: true } as const;

function node(calls: number, tokens: number, cost: number, extra: Partial<NodeResult> = {}): NodeResult {
  return {
    status: "success",
    data: { answer: "SECRET MODEL PROSE" },
    toolCalls: Array.from({ length: calls }, () => ({ tool: "Read", input: { path: "SECRET INPUT" } })),
    usage: { inputTokens: tokens - 500, outputTokens: 500, costUsd: cost },
    policy: SCOPED,
    ...extra,
  };
}

const success: TicketData = {
  workflow: "explain-repo",
  runId: RUN,
  summary: summarizeRun(
    new Map([
      ["survey", node(12, 22_450, 0.09)],
      ["explain", node(0, 7_440, 0.04)],
    ]),
    27_500,
  ),
};

const failure: TicketData = {
  workflow: "pr-review",
  runId: RUN,
  summary: summarizeRun(
    new Map<string, NodeResult>([
      ["gather", node(5, 1_500, 0.05, { usage: undefined })],
      [
        "analyze",
        {
          status: "failed",
          data: { error: "SECRET MODEL PROSE" },
          toolCalls: [{ tool: "t", input: {} }],
          usage: { inputTokens: 1000, outputTokens: 500, costUsd: 0.05 },
          policy: { envScope: true, sandbox: "auto", sandboxStarted: false },
        },
      ],
      ["report", { status: "skipped", data: {}, toolCalls: [] }],
    ]),
    65_000,
  ),
};

const budgetStop: TicketData = {
  workflow: "triage",
  runId: RUN,
  summary: summarizeRun(
    new Map<string, NodeResult>([
      [
        "gather",
        node(31, 52_300, 0.21, {
          status: "failed",
          budget: { scope: "run", unit: "tokens", limit: 50_000, spent: 52_300 },
        }),
      ],
    ]),
    94_000,
  ),
};

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderTicket: the signature renderings", () => {
  it("success", () => {
    expect(renderTicket(success).lines).toEqual([
      "╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮",
      "┆ ✓ passed                          run 3f9a2c ┆",
      "┆ explain-repo                                 ┆",
      "┆                                              ┆",
      "┆ nodes       2/2                              ┆",
      "┆ tool calls  12                               ┆",
      "┆ duration    28s                              ┆",
      "┆ tokens      30k                              ┆",
      "┆ cost        $0.13                            ┆",
      "┆ policy      env scoped, sandbox on           ┆",
      "├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤",
      "┆          [ ENV SCOPED · SANDBOXED ]          ┆",
      "╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯",
    ]);
  });

  it("failure: failed and skipped counts, a weaker stamp, a wrapped policy value", () => {
    expect(renderTicket(failure).lines).toEqual([
      "╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮",
      "┆ ✗ failed                          run 3f9a2c ┆",
      "┆ pr-review                                    ┆",
      "┆                                              ┆",
      "┆ nodes       1/3, 1 failed, 1 skipped         ┆",
      "┆ tool calls  6                                ┆",
      "┆ duration    1m05s                            ┆",
      "┆ tokens      1.5k                             ┆",
      "┆ cost        $0.05                            ┆",
      "┆ policy      env scoped, sandbox unavailable  ┆",
      "┆             (ran unsandboxed)                ┆",
      "├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤",
      "┆         [ ENV SCOPED · UNSANDBOXED ]         ┆",
      "╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯",
    ]);
  });

  it("budget stop: the status says so, the overrun and the stopping node are fields", () => {
    expect(renderTicket(budgetStop).lines).toEqual([
      "╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮",
      "┆ ✗ budget stop                     run 3f9a2c ┆",
      "┆ triage                                       ┆",
      "┆                                              ┆",
      "┆ nodes       0/1, 1 failed                    ┆",
      "┆ tool calls  31                               ┆",
      "┆ duration    1m34s                            ┆",
      "┆ tokens      52k                              ┆",
      "┆ cost        $0.21                            ┆",
      "┆ budget      tokens 52k of 50k (run)          ┆",
      "┆ stopped at  gather                           ┆",
      "┆ policy      env scoped, sandbox on           ┆",
      "├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤",
      "┆          [ ENV SCOPED · SANDBOXED ]          ┆",
      "╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯",
    ]);
  });

  it("narrow terminal (40 columns): fits beside the indent, columns still aligned", () => {
    expect(renderTicket(success, { columns: 40 }).lines).toEqual([
      "╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮",
      "┆ ✓ passed                run 3f9a2c ┆",
      "┆ explain-repo                       ┆",
      "┆                                    ┆",
      "┆ nodes       2/2                    ┆",
      "┆ tool calls  12                     ┆",
      "┆ duration    28s                    ┆",
      "┆ tokens      30k                    ┆",
      "┆ cost        $0.13                  ┆",
      "┆ policy      env scoped, sandbox on ┆",
      "├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤",
      "┆     [ ENV SCOPED · SANDBOXED ]     ┆",
      "╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯",
    ]);
  });

  it("ASCII when the terminal lacks Unicode", () => {
    expect(renderTicket(success, { unicode: false }).lines).toEqual([
      "+----------------------------------------------+",
      ": + passed                          run 3f9a2c :",
      ": explain-repo                                 :",
      ":                                              :",
      ": nodes       2/2                              :",
      ": tool calls  12                               :",
      ": duration    28s                              :",
      ": tokens      30k                              :",
      ": cost        $0.13                            :",
      ": policy      env scoped, sandbox on           :",
      "+- - - - - - - - - - - - - - - - - - - - - - - +",
      ":          [ ENV SCOPED | SANDBOXED ]          :",
      "+----------------------------------------------+",
    ]);
  });

  it("no policy facts: no tear line, no stamp", () => {
    const t = renderTicket({ workflow: "demo", summary: summarizeRun(new Map([["a", node(0, 10, 0)]]), 1000) });
    expect(t.stampRow).toBeGreaterThan(0);
    const bare = renderTicket({
      workflow: "demo",
      summary: summarizeRun(new Map<string, NodeResult>([["a", { status: "success", data: {}, toolCalls: [] }]]), 1000),
    });
    expect(bare.stampRow).toBe(-1);
    expect(bare.lines.join("\n")).not.toContain("[");
    expect(bare.lines.join("\n")).not.toContain("╌");
  });
});

describe("renderTicket: layout invariants", () => {
  const cases = [success, failure, budgetStop];

  it("every row is exactly the ticket width, at every terminal width", () => {
    for (const columns of [20, 34, 40, 50, 80, 200]) {
      for (const unicode of [true, false]) {
        for (const data of cases) {
          const { lines } = renderTicket(data, { columns, unicode });
          const w = ticketWidth(columns);
          for (const l of lines) expect([...l].length, `${columns} cols: ${l}`).toBe(w);
        }
      }
    }
  });

  it("width is clamped: never past the indent at 40 columns, never wider than the max", () => {
    expect(ticketWidth(40)).toBe(38);
    expect(ticketWidth(80)).toBe(TICKET_MAX_WIDTH);
    expect(ticketWidth(10)).toBe(TICKET_MIN_WIDTH);
  });

  it("colored rows keep the same visible width as plain rows", () => {
    const plain = renderTicket(failure).lines;
    const painted = renderTicket(failure, { paint: createPaint(true) }).lines;
    expect(painted.join("\n")).toMatch(/\x1b\[/);
    expect(painted.map(visible)).toEqual(plain);
  });

  it("ASCII rows are printable ASCII only", () => {
    for (const data of cases) {
      expect(renderTicket(data, { unicode: false }).lines.join("\n")).toMatch(/^[\x20-\x7e\n]*$/);
    }
  });

  it("carries metadata only, and no em dash", () => {
    const text = cases.map((d) => formatTicketText(d)).join("\n");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("\u2014");
  });

  it("stamp: false leaves the stub row empty, same shape", () => {
    const full = renderTicket(success);
    const blank = renderTicket(success, { stamp: false });
    expect(blank.stampRow).toBe(full.stampRow);
    expect(blank.lines[blank.stampRow].replace(/[┆ ]/g, "")).toBe("");
    expect(blank.lines.filter((_, i) => i !== full.stampRow)).toEqual(full.lines.filter((_, i) => i !== full.stampRow));
  });

  it("a long workflow id is clipped with an ellipsis", () => {
    const t = renderTicket({ ...success, workflow: "x".repeat(80) }, { columns: 40 });
    expect(t.lines[2]).toMatch(/x… ┆$/);
  });
});

describe("stamp words and run id", () => {
  it("names env scope and sandbox; weaker facts are not strong", () => {
    expect(stampWords(success.summary)).toEqual({ words: ["ENV SCOPED", "SANDBOXED"], strong: true });
    expect(stampWords(failure.summary)).toEqual({ words: ["ENV SCOPED", "UNSANDBOXED"], strong: false });
    const unscoped = summarizeRun(
      new Map([["a", node(0, 10, 0, { policy: { envScope: false, sandbox: "off", sandboxStarted: false } })]]),
      1,
    );
    expect(stampWords(unscoped)).toEqual({ words: ["ENV UNSCOPED", "UNSANDBOXED"], strong: false });
  });

  it("short run id is the random suffix", () => {
    expect(shortRunId(RUN)).toBe("3f9a2c");
    expect(shortRunId("demo")).toBe("demo");
  });
});

describe("writeReceipt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function sink(isTTY: boolean, columns = 80) {
    let out = "";
    return { stream: { isTTY, columns, write: (s: string) => (out += s) }, read: () => out };
  }

  it("non-TTY keeps the plain receipt line, no ANSI", async () => {
    const s = sink(false);
    await writeReceipt(success.summary, { workflow: "explain-repo", runId: RUN, stream: s.stream, env: {} });
    expect(s.read()).toBe(`  ${formatReceipt(success.summary)}\n\n`);
  });

  it("CI keeps the plain line even on a TTY", async () => {
    const s = sink(true);
    await writeReceipt(success.summary, { workflow: "explain-repo", stream: s.stream, env: { CI: "true" } });
    // A TTY still gets color on the plain line; the shape is the plain receipt.
    expect(visible(s.read())).toBe(`  ${formatReceipt(success.summary)}\n\n`);
    expect(s.read()).not.toContain("╭");
  });

  it("a TTY gets the ticket; NO_COLOR keeps it free of ANSI", async () => {
    const s = sink(true);
    await writeReceipt(success.summary, {
      workflow: "explain-repo",
      runId: RUN,
      stream: s.stream,
      env: { NO_COLOR: "1", LANG: "en_US.UTF-8" },
      animate: false,
    });
    const expected = renderTicket(success).lines.map((l) => `  ${l}`);
    expect(s.read()).toBe(expected.join("\n") + "\n\n");
  });

  it("a TTY in a C locale gets the ASCII ticket at the terminal's width", async () => {
    const s = sink(true, 40);
    await writeReceipt(success.summary, {
      workflow: "explain-repo",
      stream: s.stream,
      env: { NO_COLOR: "1", LANG: "C" },
      animate: false,
    });
    const rows = s.read().trimEnd().split("\n");
    expect(rows[0]).toBe(`  +${"-".repeat(36)}+`);
    expect(rows.every((r) => r.length <= 40)).toBe(true);
  });

  it("the stamp lands one frame after the ticket", async () => {
    vi.useFakeTimers();
    const s = sink(true);
    const done = writeReceipt(success.summary, {
      workflow: "explain-repo",
      runId: RUN,
      stream: s.stream,
      env: { NO_COLOR: "1", LANG: "en_US.UTF-8" },
    });
    const first = s.read();
    expect(first).not.toContain("SANDBOXED");
    expect(first).toContain("run 3f9a2c");
    await vi.advanceTimersByTimeAsync(STAMP_DELAY_MS);
    await done;
    const full = renderTicket(success);
    const up = full.lines.length - full.stampRow;
    expect(s.read().slice(first.length)).toBe(`\x1B[${up}A\r\x1B[2K  ${full.lines[full.stampRow]}\x1B[${up}B\r\n`);
  });
});
