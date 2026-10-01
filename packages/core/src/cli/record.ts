/**
 * `sweny try --record <file.svg>`: the demo as an animated terminal SVG.
 *
 * Runs the real `sweny try` replay (instant, no TTY) with color forced on,
 * captures the ANSI text, and lays it out as a slate terminal window whose
 * lines appear on a CSS keyframe timeline: the command, a spinner per node
 * until it settles, the answer, the receipt ticket with its stamp
 * landing last. Then it loops.
 *
 * Self-contained by construction: inline CSS only, a monospace font stack, no
 * external fonts, images, links or scripts. Deterministic: no clock, no ids,
 * no randomness; the same fixture and theme always yield the same bytes, so
 * CI can regenerate the file and fail when the committed copy is stale.
 * `prefers-reduced-motion` shows the finished frame with no animation.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { GLYPHS, PALETTE, ROLE_COLORS, SPINNER_FRAMES, SURFACE_COLORS } from "../theme.js";
import { loadTryFixture, runTry, type TryFixture } from "./try.js";

/** Terminal width the demo is rendered at (the ticket and DAG are designed for 80). */
export const RECORD_COLUMNS = 80;
/** Lines longer than this wrap in the window, like a terminal would. */
export const RECORD_WRAP = 96;

const FONT_SIZE = 13;
const CELL_W = 7.85;
const LINE_H = 19;
const PAD_X = 24;
const BAR_H = 38;
const PAD_TOP = 18;
const PAD_BOTTOM = 22;
const WINDOW_W = Math.ceil(RECORD_WRAP * CELL_W + PAD_X * 2);
const FONT_STACK = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

const SECONDS_PER_LINE = 0.06;
const SECONDS_PER_BLANK = 0.25;
const SECONDS_STAMP_DELAY = 0.5;
const SECONDS_HOLD = 5;

// ── ANSI to styled cells ────────────────────────────────────────

export interface Style {
  fg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

export interface Cell {
  ch: string;
  style: Style;
}

const BASIC_COLORS: Record<number, string> = {
  30: PALETTE.slate900,
  31: ROLE_COLORS.error,
  32: ROLE_COLORS.success,
  33: ROLE_COLORS.warning,
  34: ROLE_COLORS.brand,
  35: PALETTE.blue300,
  36: ROLE_COLORS.info,
  37: SURFACE_COLORS.dark.text,
  90: ROLE_COLORS.muted,
  91: ROLE_COLORS.error,
  92: ROLE_COLORS.success,
  93: ROLE_COLORS.warning,
  94: ROLE_COLORS.info,
  95: PALETTE.blue300,
  96: ROLE_COLORS.info,
  97: PALETTE.white,
};

const hex = (n: number) => n.toString(16).padStart(2, "0");

/** Apply one SGR parameter list to a style. */
function applySgr(style: Style, params: number[]): Style {
  const next = { ...style };
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) return {};
    else if (p === 1) next.bold = true;
    else if (p === 2) next.dim = true;
    else if (p === 22) {
      delete next.bold;
      delete next.dim;
    } else if (p === 4) next.underline = true;
    else if (p === 24) delete next.underline;
    else if (p === 39) delete next.fg;
    else if (p === 38 && params[i + 1] === 2) {
      next.fg = `#${hex(params[i + 2] ?? 0)}${hex(params[i + 3] ?? 0)}${hex(params[i + 4] ?? 0)}`;
      i += 4;
    } else if (p === 38 && params[i + 1] === 5) {
      next.fg = SURFACE_COLORS.dark.text;
      i += 2;
    } else if (BASIC_COLORS[p]) next.fg = BASIC_COLORS[p];
  }
  return next;
}

/** One line of ANSI text as styled cells. Cursor and erase sequences are dropped. */
export function parseAnsiLine(line: string): Cell[] {
  const cells: Cell[] = [];
  let style: Style = {};
  const re = /\x1B\[([0-9;]*)([A-Za-z])/g;
  let last = 0;
  const push = (text: string) => {
    for (const ch of text.replace(/\r/g, "")) cells.push({ ch, style });
  };
  for (let m = re.exec(line); m; m = re.exec(line)) {
    push(line.slice(last, m.index));
    if (m[2] === "m") style = applySgr(style, m[1] === "" ? [0] : m[1].split(";").map(Number));
    last = m.index + m[0].length;
  }
  push(line.slice(last));
  return cells;
}

const sameStyle = (a: Style, b: Style) =>
  a.fg === b.fg && !!a.bold === !!b.bold && !!a.dim === !!b.dim && !!a.underline === !!b.underline;

/** Soft-wrap a row of cells at `max` columns, on spaces, continuation indented two past the first. */
export function wrapCells(cells: Cell[], max: number): Cell[][] {
  const rows: Cell[][] = [];
  const indent = cells.findIndex((c) => c.ch !== " ");
  const pad = " ".repeat(Math.max(0, indent) + 2);
  let rest = cells;
  while (rest.length > max) {
    let cut = -1;
    for (let i = max; i > pad.length; i--) {
      if (rest[i].ch === " ") {
        cut = i;
        break;
      }
    }
    if (cut < 0) cut = max;
    rows.push(rest.slice(0, cut));
    let tail = rest.slice(cut);
    while (tail.length > 0 && tail[0].ch === " ") tail = tail.slice(1);
    rest = [...[...pad].map((ch) => ({ ch, style: {} as Style })), ...tail];
  }
  rows.push(rest);
  return rows;
}

const plainText = (cells: Cell[]) => cells.map((c) => c.ch).join("");

// ── Timeline ────────────────────────────────────────────────────

export interface Row {
  cells: Cell[];
  /** Vertical slot. A spinner shares the slot of the line that replaces it. */
  slot: number;
  /** Seconds at which the row appears. */
  from: number;
  /** Seconds at which it disappears again (spinners). Absent: stays until the loop restarts. */
  to?: number;
  spinner?: boolean;
}

function textCells(text: string, style: Style = {}): Cell[] {
  return [...text].map((ch) => ({ ch, style }));
}

/** Lay captured output lines on the timeline. Pure. */
export function buildTimeline(lines: string[], fixture: TryFixture): { rows: Row[]; slots: number; total: number } {
  const rows: Row[] = [];
  const nodeIds = Object.keys(fixture.nodes);
  const settledPrefix = (id: string) => `  ${GLYPHS.unicode.success} ${id}`;
  const spinnerGlyph = SPINNER_FRAMES.unicode[3];
  let t = 0.5;
  let slot = 0;

  // The command being typed.
  rows.push({
    cells: [...textCells("$ ", { fg: ROLE_COLORS.muted }), ...textCells("sweny try", { bold: true })],
    slot: slot++,
    from: t,
  });
  t += 0.9;

  for (const line of lines) {
    const cells = parseAnsiLine(line);
    const text = plainText(cells);
    const id = nodeIds.find((n) => text.startsWith(settledPrefix(n)));
    if (id) {
      const seconds = 0.8 + Math.min(1.6, fixture.nodes[id].duration_ms / 12000);
      rows.push({
        cells: [...textCells("  "), ...textCells(spinnerGlyph, { fg: ROLE_COLORS.brand }), ...textCells(` ${id}`)],
        slot,
        from: t,
        to: t + seconds,
        spinner: true,
      });
      t += seconds;
    } else if (/\[ (ENV|SANDBOXED|UNSANDBOXED)\b/.test(text)) {
      // The policy stamp lands a beat after the card.
      t += SECONDS_STAMP_DELAY;
    }
    for (const part of wrapCells(cells, RECORD_WRAP)) {
      rows.push({ cells: part, slot, from: t });
      slot++;
    }
    t += text.trim() === "" ? SECONDS_PER_BLANK : SECONDS_PER_LINE;
  }
  return { rows, slots: slot, total: t + SECONDS_HOLD };
}

// ── SVG ─────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (seconds: number, total: number) => ((seconds / total) * 100).toFixed(2);

/** Render the timeline as a self-contained animated SVG. Pure and deterministic. */
export function renderRecordingSvg(lines: string[], fixture: TryFixture): string {
  const { rows, slots, total } = buildTimeline(lines, fixture);
  const height = BAR_H + PAD_TOP + slots * LINE_H + PAD_BOTTOM;
  const dark = SURFACE_COLORS.dark;

  // Color classes by first use, so the CSS is small and the order is stable.
  const colorClass = new Map<string, string>();
  const classFor = (style: Style): string => {
    const names: string[] = [];
    if (style.fg) {
      let c = colorClass.get(style.fg);
      if (!c) {
        c = `c${colorClass.size}`;
        colorClass.set(style.fg, c);
      }
      names.push(c);
    }
    if (style.bold) names.push("b");
    if (style.dim) names.push("d");
    if (style.underline) names.push("u");
    return names.join(" ");
  };

  // Keyframes by (from, to), numbered by first use.
  const frames = new Map<string, string>();
  const frameFor = (from: number, to?: number): string => {
    const key = `${pct(from, total)}:${to === undefined ? "" : pct(to, total)}`;
    let name = frames.get(key);
    if (!name) {
      name = `k${frames.size}`;
      frames.set(key, name);
    }
    return name;
  };

  const body: string[] = [];
  for (const row of rows) {
    const y = BAR_H + PAD_TOP + row.slot * LINE_H + FONT_SIZE;
    const spans: string[] = [];
    let i = 0;
    while (i < row.cells.length) {
      let j = i + 1;
      while (j < row.cells.length && sameStyle(row.cells[i].style, row.cells[j].style)) j++;
      const text = esc(
        row.cells
          .slice(i, j)
          .map((c) => c.ch)
          .join(""),
      );
      const cls = classFor(row.cells[i].style);
      spans.push(cls ? `<tspan class="${cls}">${text}</tspan>` : text);
      i = j;
    }
    const cls = `r ${frameFor(row.from, row.to)}${row.spinner ? " sp" : ""}`;
    body.push(`<text class="${cls}" x="${PAD_X}" y="${y}">${spans.join("")}</text>`);
  }

  const css: string[] = [
    `text{font-family:${FONT_STACK};font-size:${FONT_SIZE}px;fill:${dark.text};white-space:pre}`,
    // No-animation default is the FINAL frame: lines visible, spinner frames hidden. Keyframes drive the replay.
    `.r{opacity:1}`,
    `.sp{opacity:0}`,
    `.b{font-weight:700}`,
    `.d{fill-opacity:.65}`,
    `.u{text-decoration:underline}`,
    `.t{fill:${dark.textSecondary};font-size:12px}`,
  ];
  for (const [fg, name] of colorClass) css.push(`.${name}{fill:${fg}}`);
  for (const [key, name] of frames) {
    const [from, to] = key.split(":");
    const a = Number(from);
    const keyframe =
      to === ""
        ? `0%,${from}%{opacity:0}${(a + 0.01).toFixed(2)}%,98%{opacity:1}100%{opacity:0}`
        : `0%,${from}%{opacity:0}${(a + 0.01).toFixed(2)}%,${to}%{opacity:1}${(Number(to) + 0.01).toFixed(2)}%,100%{opacity:0}`;
    css.push(`@keyframes ${name}{${keyframe}}`);
    css.push(`.${name}{animation:${name} ${total.toFixed(2)}s linear infinite}`);
  }
  css.push(`@media (prefers-reduced-motion:reduce){.r{animation:none!important}.sp{display:none}}`);

  const label = "Recorded demo of sweny try: two nodes run, then the answer and the receipt ticket.";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WINDOW_W} ${height}" width="${WINDOW_W}" height="${height}" role="img" aria-label="${esc(label)}">`,
    `<title>sweny try</title>`,
    `<style>${css.join("")}</style>`,
    `<rect x="0.5" y="0.5" width="${WINDOW_W - 1}" height="${height - 1}" rx="10" fill="${dark.background}" stroke="${dark.border}"/>`,
    `<path d="M0.5 ${BAR_H}V10.5A10 10 0 0 1 10.5 0.5H${WINDOW_W - 10.5}A10 10 0 0 1 ${WINDOW_W - 0.5} 10.5V${BAR_H}Z" fill="${PALETTE.slate900}" stroke="${dark.border}"/>`,
    `<circle cx="20" cy="19" r="5.5" fill="${ROLE_COLORS.error}"/>`,
    `<circle cx="40" cy="19" r="5.5" fill="${ROLE_COLORS.warning}"/>`,
    `<circle cx="60" cy="19" r="5.5" fill="${ROLE_COLORS.success}"/>`,
    `<text class="t" x="${WINDOW_W / 2}" y="23" text-anchor="middle">sweny try</text>`,
    ...body,
    `</svg>`,
    ``,
  ].join("\n");
}

// ── Entry points ────────────────────────────────────────────────

const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");

/**
 * The PR-comment preview (heading plus DAG) sits between the answer and the
 * ticket. The recording drops it to stay a README-sized hero: tagline, nodes,
 * answer, ticket.
 */
export function dropCommentPreview(lines: string[]): string[] {
  const from = lines.findIndex((l) => stripAnsi(l).includes("On a pull request, CI posts"));
  const to = lines.findIndex((l, i) => i > from && stripAnsi(l).startsWith("  \u256D"));
  if (from < 0 || to < 0) return lines;
  return [...lines.slice(0, from), ...lines.slice(to)];
}

/** Run the demo and return the SVG text. */
export async function recordTrySvg(fixture: TryFixture = loadTryFixture()): Promise<string> {
  let out = "";
  // The DAG renderer paints through the default chalk; pin it so the capture carries color on any host.
  const prevLevel = chalk.level;
  chalk.level = 3;
  try {
    const code = await runTry({
      fast: true,
      tty: false,
      color: true,
      rich: true,
      unicode: true,
      columns: RECORD_COLUMNS,
      fixture,
      write: (s) => {
        out += s;
      },
    });
    if (code !== 0) throw new Error(`the demo run exited ${code}`);
  } finally {
    chalk.level = prevLevel;
  }
  const lines = out.split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return renderRecordingSvg(dropCommentPreview(lines), fixture);
}

/** Record to `file`, creating its directory. Returns the byte size written. */
export async function recordTrySvgToFile(file: string, fixture?: TryFixture): Promise<number> {
  const svg = await recordTrySvg(fixture);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, svg);
  return Buffer.byteLength(svg);
}
