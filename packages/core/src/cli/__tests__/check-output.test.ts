/**
 * `sweny check`'s box (#532): painted through createPaint and the theme
 * GLYPHS, so NO_COLOR and ASCII terminals get the same words.
 */

import { describe, it, expect } from "vitest";
import { formatCheckResults, stripAnsi } from "../output.js";
import { GLYPHS } from "../../theme.js";
import type { CheckResult } from "../check.js";

const RESULTS: CheckResult[] = [
  { name: "Agent CLI (codex)", status: "ok", detail: "0.159.2 (/usr/bin/codex)" },
  {
    name: "Agent auth (codex)",
    status: "fail",
    detail: "Missing: OPENAI_API_KEY or CODEX_API_KEY, or a Codex login (`codex login`), for --agent codex",
  },
  { name: "OpenAI API (codex agent)", status: "skip", detail: "skipping upstream API check" },
];

const ESC = /\x1b\[/;

describe("formatCheckResults", () => {
  it("color off (NO_COLOR, a pipe): no ANSI at all", () => {
    expect(formatCheckResults(RESULTS, { color: false })).not.toMatch(ESC);
  });

  it("color on: ANSI, and the same text once stripped", () => {
    const colored = formatCheckResults(RESULTS, { color: true });
    expect(colored).toMatch(ESC);
    expect(stripAnsi(colored)).toBe(formatCheckResults(RESULTS, { color: false }));
  });

  it("defaults to no color and Unicode", () => {
    expect(formatCheckResults(RESULTS)).toBe(formatCheckResults(RESULTS, { color: false, unicode: true }));
  });

  it("Unicode: the theme glyph per status and box lines", () => {
    const out = formatCheckResults(RESULTS, { color: false, unicode: true });
    const g = GLYPHS.unicode;
    expect(out).toContain(`${g.success}  Agent CLI (codex)`);
    expect(out).toContain(`${g.failure}  Agent auth (codex)`);
    expect(out).toContain(`${g.skipped}  OpenAI API (codex agent)`);
    expect(out).toMatch(/╭─+╮/);
  });

  it("ASCII: the theme's ASCII glyphs and box, no Unicode drawing left", () => {
    const out = formatCheckResults(RESULTS, { color: false, unicode: false });
    const g = GLYPHS.ascii;
    expect(out).toContain(`${g.success}  Agent CLI (codex)`);
    expect(out).toContain(`${g.failure}  Agent auth (codex)`);
    expect(out).toContain(`${g.skipped}  OpenAI API (codex agent)`);
    expect(out).toMatch(/^ {2}\+-+\+$/m);
    expect(out).not.toMatch(/[╭╮╰╯─│├┤✓✗−]/);
  });

  it("every box line has the same width, long details wrapped inside it", () => {
    const lines = formatCheckResults(RESULTS, { color: true })
      .split("\n")
      .filter((l) => l.trim() !== "");
    for (const l of lines) expect(stripAnsi(l).length, l).toBe(54);
    // The long auth detail wraps, every word kept, indented under the name.
    const text = stripAnsi(formatCheckResults(RESULTS)).replace(/[│\s]+/g, " ");
    expect(text).toContain(RESULTS[1].detail);
  });

  it("summary: failure, all skipped, all passed", () => {
    const words = (r: CheckResult[]) => formatCheckResults(r).replace(/[│\s]+/g, " ");
    expect(words(RESULTS)).toMatch(/One or more checks failed/);
    expect(words([RESULTS[2]])).toMatch(/no network checks performed/);
    expect(words([RESULTS[0]])).toMatch(/All checks passed/);
  });
});
