import { describe, it, expect } from "vitest";
import { colorEnabled, richOutput, supportsUnicode, terminalColumns, toAsciiDrawing } from "./terminal.js";
import { createNodeProgress } from "./progress.js";
import { createPaint } from "./style.js";

describe("supportsUnicode", () => {
  it("follows the locale on POSIX", () => {
    expect(supportsUnicode({ LANG: "en_US.UTF-8" }, "linux")).toBe(true);
    expect(supportsUnicode({ LC_ALL: "C.utf8" }, "linux")).toBe(true);
    expect(supportsUnicode({ LANG: "C" }, "linux")).toBe(false);
    expect(supportsUnicode({ LANG: "POSIX" }, "darwin")).toBe(false);
    // LC_ALL wins over LANG
    expect(supportsUnicode({ LC_ALL: "C", LANG: "en_US.UTF-8" }, "linux")).toBe(false);
    expect(supportsUnicode({}, "darwin")).toBe(true);
  });

  it("the Linux console and the escape hatches", () => {
    expect(supportsUnicode({ TERM: "linux", LANG: "en_US.UTF-8" }, "linux")).toBe(false);
    expect(supportsUnicode({ SWENY_ASCII: "1", LANG: "en_US.UTF-8" }, "linux")).toBe(false);
    expect(supportsUnicode({ SWENY_UNICODE: "1", LANG: "C" }, "linux")).toBe(true);
  });

  it("Windows: only terminals known to draw it", () => {
    expect(supportsUnicode({}, "win32")).toBe(false);
    expect(supportsUnicode({ WT_SESSION: "x" }, "win32")).toBe(true);
    expect(supportsUnicode({ TERM_PROGRAM: "vscode" }, "win32")).toBe(true);
  });
});

describe("colorEnabled / richOutput / terminalColumns", () => {
  it("NO_COLOR always wins; FORCE_COLOR next; else a TTY", () => {
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: "1", FORCE_COLOR: "1" })).toBe(false);
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(true);
    expect(colorEnabled({ isTTY: true }, { FORCE_COLOR: "0" })).toBe(false);
    expect(colorEnabled({ isTTY: true }, { TERM: "dumb" })).toBe(false);
    expect(colorEnabled({ isTTY: true }, {})).toBe(true);
    expect(colorEnabled({ isTTY: false }, {})).toBe(false);
  });

  it("rich output needs a TTY and not CI", () => {
    expect(richOutput({ isTTY: true }, {})).toBe(true);
    expect(richOutput({ isTTY: true }, { CI: "true" })).toBe(false);
    expect(richOutput({ isTTY: false }, {})).toBe(false);
  });

  it("columns from the stream, then COLUMNS, then 80", () => {
    expect(terminalColumns({ columns: 40 }, { COLUMNS: "100" })).toBe(40);
    expect(terminalColumns({}, { COLUMNS: "100" })).toBe(100);
    expect(terminalColumns(undefined, {})).toBe(80);
  });
});

describe("toAsciiDrawing", () => {
  it("maps box drawing and glyphs one column for one column", () => {
    const uni = "┌──▼──┐ ✓ ● ○ ✗ │ └──┬──┘";
    const ascii = toAsciiDrawing(uni);
    expect(ascii).toBe("+--v--+ + * o x | +--+--+");
    expect(ascii.length).toBe(uni.length);
  });
});

describe("createNodeProgress", () => {
  const paint = createPaint(false);

  it("not live: an announce line, then one settled line, no escapes", () => {
    let out = "";
    const p = createNodeProgress({ write: (s) => (out += s), live: false, unicode: true, paint, announce: true });
    p.enter("gather");
    p.tick("gather");
    p.exit("gather", "success", "1.2s · 1 tool call");
    expect(out).toBe("  ○ gather…\n  ✓ gather  1.2s · 1 tool call\n");
  });

  it("live: a spinner redrawn in place, cleared when the node settles", () => {
    let out = "";
    const p = createNodeProgress({ write: (s) => (out += s), live: true, unicode: false, paint, idWidth: 8 });
    p.enter("gather");
    p.exit("gather", "failed", "3s");
    expect(out).toBe("\r\x1B[2K  | gather\r\x1B[2K  x gather    3s\n");
    p.stop();
  });
});
