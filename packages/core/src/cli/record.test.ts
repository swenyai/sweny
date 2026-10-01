import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SWENY_TAGLINE } from "../theme.js";
import { SPINNER_FRAMES } from "../theme.js";
import { CELL_W, TEXT_X, RECORD_WRAP, parseAnsiLine, recordTrySvg, recordTrySvgToFile, wrapCells } from "./record.js";

const NBSP = String.fromCharCode(0xa0);
const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("parseAnsiLine", () => {
  it("turns truecolor, bold and dim into styled cells and drops cursor codes", () => {
    const cells = parseAnsiLine("\x1B[38;2;59;130;246mab\x1B[39m \x1B[1mc\x1B[22m\x1B[2m\x1B[2Kd\x1B[22m");
    expect(cells.map((c) => c.ch).join("")).toBe("ab cd");
    expect(cells[0].style.fg).toBe("#3b82f6");
    expect(cells[2].style.fg).toBeUndefined();
    expect(cells[3].style.bold).toBe(true);
    expect(cells[4].style.dim).toBe(true);
    expect(cells[4].style.bold).toBeUndefined();
  });
});

describe("wrapCells", () => {
  it("wraps long lines on spaces with an indented continuation, and leaves short ones alone", () => {
    const text = "  " + "word ".repeat(30).trim();
    const rows = wrapCells(parseAnsiLine(text), 40);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(40);
    expect(rows[1].map((c) => c.ch).join("")).toMatch(/^ {4}word/);
    expect(wrapCells(parseAnsiLine("short"), 40)).toHaveLength(1);
  });
});

describe("recordTrySvg", () => {
  it("is deterministic: two recordings are byte-identical", async () => {
    expect(await recordTrySvg()).toBe(await recordTrySvg());
  });

  it("is self-contained: no scripts, fonts, images, links or external references", async () => {
    const svg = await recordTrySvg();
    expect(svg.startsWith("<svg ")).toBe(true);
    for (const banned of ["<script", "@import", "<image", "href=", "font-face", "url(", "<foreignObject"]) {
      expect(svg).not.toContain(banned);
    }
    // The only URLs are the SVG namespace and text in the sample answer; nothing is fetched.
    const urls = (svg.match(/https?:\/\/[^"'\s)<]+/g) ?? []).filter((u) => !u.startsWith("http://localhost"));
    expect(urls).toEqual(["http://www.w3.org/2000/svg"]);
  });

  it("animates with CSS keyframes, respects reduced motion, and stays small", async () => {
    const svg = await recordTrySvg();
    expect(svg).toContain("@keyframes");
    expect(svg).toContain("prefers-reduced-motion");
    expect(svg).toContain("monospace");
    expect(Buffer.byteLength(svg)).toBeLessThan(60_000);
  });

  it("shows the real demo: tagline, both nodes, the answer, the ticket and the stamp, in brand colors", async () => {
    const svg = (await recordTrySvg()).replace(new RegExp(NBSP, "g"), " ");
    expect(svg).toContain(SWENY_TAGLINE);
    expect(svg).toContain("survey");
    expect(svg).toContain("explain");
    expect(svg).toContain("What it is:");
    expect(svg).toContain("passed");
    expect(svg).toContain("ENV SCOPED");
    expect(svg).toContain("#3b82f6");
    expect(svg).toContain("#1e293b");
  });

  it("has no em dashes and nothing wider than the window wraps to", async () => {
    const svg = await recordTrySvg();
    expect(svg).not.toContain(String.fromCharCode(0x2014));
    for (const m of svg.matchAll(/<text class="r [^"]*"[^>]*>(.*?)<\/text>/g)) {
      const visible = m[1].replace(/<[^>]+>/g, "").replace(/&amp;|&lt;|&gt;/g, "x");
      expect([...visible].length).toBeLessThanOrEqual(RECORD_WRAP);
    }
  });

  it("defaults to the final frame: persistent lines visible, spinner frames hidden, keyframes start hidden", async () => {
    const svg = await recordTrySvg();
    const css = /<style>(.*?)<\/style>/s.exec(svg)![1];
    // Effective default opacity of a class list: the last rule that sets opacity wins.
    const opacityRules = [...css.matchAll(/\.([a-z0-9]+)\{opacity:([\d.]+)\}/g)].map(
      (m) => [m[1], Number(m[2])] as const,
    );
    const effective = (classes: string[]) => {
      let o: number | undefined;
      for (const [name, val] of opacityRules) if (classes.includes(name)) o = val;
      return o;
    };
    const spinnerChars = new Set<string>(SPINNER_FRAMES.unicode);
    let persistent = 0;
    let transient = 0;
    for (const m of svg.matchAll(/<text class="(r [^"]*)"[^>]*>(.*?)<\/text>/g)) {
      const classes = m[1].split(" ");
      const visible = m[2].replace(/<[^>]+>/g, "");
      const isSpinner = [...visible].some((ch) => spinnerChars.has(ch));
      expect(classes.includes("sp"), visible).toBe(isSpinner);
      expect(effective(classes), visible).toBe(isSpinner ? 0 : 1);
      const kf = classes.find((c) => /^k\d+$/.test(c))!;
      expect(css).toMatch(new RegExp(`@keyframes ${kf}\\{0%,[\\d.]+%\\{opacity:0\\}`));
      if (isSpinner) transient++;
      else persistent++;
    }
    expect(persistent).toBeGreaterThan(10);
    expect(transient).toBeGreaterThan(0);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{\.r\{animation:none!important\}\.sp\{display:none\}\}/);
  });

  it("is README-sized: no PR-comment preview, under 900px tall", async () => {
    const svg = await recordTrySvg();
    expect(svg).not.toContain("On a pull request");
    expect(svg).toContain("passed");
    const h = Number(/viewBox="0 0 \d+ (\d+)"/.exec(svg)![1]);
    expect(h).toBeLessThan(900);
  });

  it("lays out by explicit columns: no reliance on whitespace handling", async () => {
    const svg = await recordTrySvg();
    expect(svg).toMatch(/^<svg [^>]*xml:space="preserve"/);
    type Seg = { x: number; text: string };
    const rows: { preserve: boolean; segs: Seg[] }[] = [];
    for (const m of svg.matchAll(/<text class="r [^"]*"([^>]*)>(.*?)<\/text>/g)) {
      const segs = [...m[2].matchAll(/<tspan x="([\d.]+)"[^>]*>(.*?)<\/tspan>/g)].map((t) => ({
        x: Number(t[1]),
        text: t[2],
      }));
      // Every character sits in a positioned tspan; no bare text nodes.
      expect(m[2].replace(/<tspan[^>]*>.*?<\/tspan>/g, "")).toBe("");
      rows.push({ preserve: m[1].includes('xml:space="preserve"'), segs });
    }
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(r.preserve).toBe(true);
      for (const seg of r.segs) {
        // No run of ASCII spaces, and no edge spaces: inner spaces are non-breaking.
        expect(seg.text).not.toMatch(/ {2}/);
        expect(seg.text).not.toMatch(/^ | $/);
        // Column-aligned: x is TEXT_X plus a whole number of cells.
        const col = (seg.x - TEXT_X) / CELL_W;
        expect(Math.abs(col - Math.round(col))).toBeLessThan(0.01);
      }
    }
    // Ticket rows: the frame's right edge sits at one x on every row.
    const ticket = rows.filter((r) => /^[\u256D\u2506\u251C\u2570]/.test(r.segs[0]?.text ?? ""));
    expect(ticket.length).toBeGreaterThan(8);
    const rightEdges = ticket.map((r) => {
      const last = r.segs[r.segs.length - 1];
      return Number((last.x + ([...last.text].length - 1) * CELL_W).toFixed(2));
    });
    expect(new Set(rightEdges).size).toBe(1);
    // Fields keep their columns: label and value are separate segments at fixed columns.
    const nodes = rows.find((r) => r.segs.some((s) => s.text === "nodes"));
    expect(nodes?.segs.some((s) => s.text.startsWith("2/2"))).toBe(true);
  });

  it("writes the file and reports its size", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-record-"));
    tmp.push(dir);
    const file = path.join(dir, "nested", "demo.svg");
    const bytes = await recordTrySvgToFile(file);
    expect(fs.readFileSync(file, "utf-8")).toBe(await recordTrySvg());
    expect(fs.statSync(file).size).toBe(bytes);
  });
});
