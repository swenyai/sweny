/**
 * What the terminal can show: color, Unicode, width, live redraws.
 *
 * Every check reads the env and stream passed in, so specs can pin each
 * case. Defaults read the real process.
 */

import { GLYPHS, SPINNER_FRAMES, TICKET_BOX, type GlyphSet, type TicketBox } from "../theme.js";

type Env = Record<string, string | undefined>;

/** The narrowest layout SWEny designs for. Narrower terminals still work, they just wrap. */
export const MIN_COLUMNS = 40;

/**
 * True when the terminal can draw box-drawing characters and the glyph set.
 *
 * `SWENY_ASCII=1` forces ASCII; `SWENY_UNICODE=1` forces Unicode. Otherwise a
 * locale that names a charset decides (`LC_ALL`, then `LC_CTYPE`, then
 * `LANG`): UTF-8 is Unicode, `C`/`POSIX`/anything else is ASCII. The Linux
 * console (`TERM=linux`) is ASCII. With no locale set, POSIX terminals are
 * assumed Unicode; Windows is Unicode only in terminals known to support it.
 */
export function supportsUnicode(env: Env = process.env, platform: string = process.platform): boolean {
  if (truthy(env.SWENY_ASCII)) return false;
  if (truthy(env.SWENY_UNICODE)) return true;
  if (env.TERM === "linux") return false;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
  if (locale) return /utf-?8/i.test(locale);
  if (platform !== "win32") return true;
  return Boolean(
    env.WT_SESSION ||
    env.TERMINUS_SUBLIME ||
    env.ConEmuTask === "{cmd::Cmder}" ||
    env.TERM_PROGRAM === "vscode" ||
    env.TERM === "xterm-256color" ||
    env.TERM === "alacritty" ||
    env.TERMINAL_EMULATOR === "JetBrains-JediTerm",
  );
}

/**
 * True when output to `stream` should carry ANSI color. `NO_COLOR` (any
 * non-empty value) always wins; then `FORCE_COLOR` (anything but `0`); then a
 * TTY that is not `TERM=dumb`.
 */
export function colorEnabled(stream: { isTTY?: boolean } | undefined, env: Env = process.env): boolean {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "") return env.FORCE_COLOR !== "0";
  if (env.TERM === "dumb") return false;
  return Boolean(stream?.isTTY);
}

/**
 * True when `stream` gets the rich view (the ticket, redraws, a spinner):
 * a TTY, not CI, not dumb. Everything else gets plain lines.
 */
export function richOutput(stream: { isTTY?: boolean } | undefined, env: Env = process.env): boolean {
  return Boolean(stream?.isTTY) && !truthy(env.CI) && env.TERM !== "dumb";
}

/** Usable width of `stream`: its column count, else `COLUMNS`, else 80. */
export function terminalColumns(stream: { columns?: number } | undefined, env: Env = process.env): number {
  const fromStream = stream?.columns;
  if (typeof fromStream === "number" && fromStream > 0) return fromStream;
  const fromEnv = Number(env.COLUMNS);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return 80;
}

export function glyphsFor(unicode: boolean): GlyphSet {
  return unicode ? GLYPHS.unicode : GLYPHS.ascii;
}

export function ticketBoxFor(unicode: boolean): TicketBox {
  return unicode ? TICKET_BOX.unicode : TICKET_BOX.ascii;
}

export function spinnerFramesFor(unicode: boolean): readonly string[] {
  return unicode ? SPINNER_FRAMES.unicode : SPINNER_FRAMES.ascii;
}

/** The glyphs for the current process. */
export function glyphs(env: Env = process.env): GlyphSet {
  return glyphsFor(supportsUnicode(env));
}

/**
 * Text that came from a file an agent can write (run history, say), made safe to print: terminal
 * control sequences are removed whole (CSI such as `ESC[2J`, OSC such as the `ESC]8;;url` hyperlink
 * and title sequences, DCS/PM/APC strings, lone ESC pairs, their 8-bit C1 forms), then any other
 * C0/C1 control character, bidi override and line separator is dropped or becomes a space; runs of
 * whitespace collapse to one space. Printable Unicode is kept. `max` caps the length (default 200,
 * `...` marks a cut).
 */
export function sanitizeTerminal(text: unknown, max = 200): string {
  const s = String(text ?? "")
    // OSC (ESC ] / 0x9d) up to BEL or ST; DCS, SOS, PM, APC (ESC P X ^ _ / 0x90 0x98 0x9e 0x9f) up to ST
    .replace(/(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?/g, "")
    .replace(/(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[^\x1b\x9c]*(?:\x1b\\|\x9c)?/g, "")
    // CSI (ESC [ / 0x9b): parameters, intermediates, final byte
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]?/g, "")
    // any other ESC pair
    .replace(/\x1b[ -~]?/g, "")
    .replace(/[\u2028\u2029\s]+/g, " ")
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  return s.length > max ? s.slice(0, Math.max(0, max - 3)) + "..." : s;
}

function truthy(v: string | undefined): boolean {
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

/**
 * Box-drawing and glyph fallbacks for text drawn with Unicode (the DAG
 * renderer). Each maps to a single ASCII column so alignment holds.
 */
const ASCII_FALLBACK: Record<string, string> = {
  "┌": "+",
  "┐": "+",
  "└": "+",
  "┘": "+",
  "├": "+",
  "┤": "+",
  "┬": "+",
  "┴": "+",
  "┼": "+",
  "╭": "+",
  "╮": "+",
  "╰": "+",
  "╯": "+",
  "─": "-",
  "┄": "-",
  "╌": "-",
  "│": "|",
  "┆": ":",
  "▼": "v",
  "▶": ">",
  [GLYPHS.unicode.success]: GLYPHS.ascii.success,
  [GLYPHS.unicode.failure]: GLYPHS.ascii.failure,
  [GLYPHS.unicode.skipped]: GLYPHS.ascii.skipped,
  [GLYPHS.unicode.pending]: GLYPHS.ascii.pending,
  [GLYPHS.unicode.running]: GLYPHS.ascii.running,
  [GLYPHS.unicode.brand]: GLYPHS.ascii.brand,
  [GLYPHS.unicode.sep]: GLYPHS.ascii.sep,
};

const ASCII_FALLBACK_RE = new RegExp(`[${Object.keys(ASCII_FALLBACK).join("")}]`, "g");

/** Replace single-column Unicode drawing characters with their ASCII stand-ins. */
export function toAsciiDrawing(text: string): string {
  return text.replace(ASCII_FALLBACK_RE, (ch) => ASCII_FALLBACK[ch] ?? ch);
}
