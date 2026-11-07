/**
 * The "what next" note after a workspace's first successful real run (#534).
 *
 * `sweny try` ends with one command to run next; a real run used to end in
 * silence, at the exact moment a user has just seen value. This prints one
 * short block (history, compare, schedule) once per workspace.
 *
 * Once means once per workspace for this user: the marker lives in sweny's
 * per-user state dir (`<state>/first-success/<workspace hash>`), never in the
 * repo, so it is not committed and an agent in the workspace cannot reset it.
 * The marker is claimed atomically (`wx`), so two runs finishing together
 * print the note once.
 *
 * Silent when: CI, a failed run, `--json`, `--stream`, `--dry-run`, or the
 * marker already exists. A marker that cannot be written means no note: a
 * note that might repeat is worse than none. Every other output (a TTY, a
 * pipe, NO_COLOR) gets the same words; only the paint and glyphs change, and
 * the last line is always plain text.
 */

import fs from "node:fs";
import path from "node:path";
import { swenyStateDir, workspaceScope } from "../journal.js";
import { createPaint, type Paint } from "./style.js";
import { colorEnabled, glyphsFor, supportsUnicode } from "./terminal.js";

type Env = Record<string, string | undefined>;

/** How to schedule a workflow you wrote: the Action's cron and dispatch triggers. */
export const SCHEDULING_DOCS_URL = "https://docs.sweny.ai/action/scheduling/";

/** The two command steps, in order. Commands are real subcommands (a spec asserts it). */
export const WHAT_NEXT_STEPS: ReadonlyArray<{ command: string; what: string }> = [
  { command: "sweny runs", what: "see this run and the ones before it" },
  { command: "sweny runs diff", what: "run it again, then see what changed in the answers" },
];

/** The third step, and the plain closing line. */
export const WHAT_NEXT_SCHEDULE = `Run it on a schedule: ${SCHEDULING_DOCS_URL}`;

function truthy(v: string | undefined): boolean {
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

/** CI: the `CI` convention, or GitHub Actions itself. */
export function inCi(env: Env = process.env): boolean {
  return truthy(env.CI) || env.GITHUB_ACTIONS === "true";
}

/**
 * The note: a heading, one aligned row per step, then a plain closing line
 * that says how to schedule it. Same words with or without color or Unicode.
 */
export function formatWhatNext(paint: Paint = createPaint(false), unicode = true): string {
  const g = glyphsFor(unicode);
  const width = Math.max(...WHAT_NEXT_STEPS.map((s) => s.command.length));
  const rows = WHAT_NEXT_STEPS.map((s) => `    ${paint.strong(s.command.padEnd(width))}  ${paint.muted(s.what)}`);
  return [`  ${paint.brand(g.brand)} ${paint.strong("Next")}`, ...rows, `  ${WHAT_NEXT_SCHEDULE}`].join("\n");
}

/** `<state>/first-success/<workspace hash>`: one empty file per workspace. */
export function firstSuccessMarker(cwd: string, env: Env = process.env): string {
  return path.join(swenyStateDir(env), "first-success", workspaceScope(cwd));
}

/**
 * Claim the workspace's marker. True only for the caller that created it.
 * False when it already exists or cannot be written (read-only home, no
 * state dir): the note then stays silent rather than risk repeating.
 */
export function claimFirstSuccess(cwd: string, env: Env = process.env): boolean {
  const file = firstSuccessMarker(cwd, env);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.closeSync(fs.openSync(file, "wx", 0o600));
    return true;
  } catch {
    return false;
  }
}

export interface WhatNextOptions {
  /** Where the note goes: the run's stdout. */
  stream: { write(s: string): unknown; isTTY?: boolean };
  /** The run succeeded (no failed node, not crashed). Anything else prints nothing. */
  ok: boolean;
  /** `--json`, `--stream` or `--dry-run`: stdout is data, or nothing real ran. */
  quiet?: boolean;
  env?: Env;
  cwd?: string;
  /** Override color. Default: `colorEnabled(stream, env)`. */
  color?: boolean;
  /** Override Unicode. Default: `supportsUnicode(env)`. */
  unicode?: boolean;
}

/** Print the note if this is the workspace's first successful real run. Returns whether it printed. */
export function writeWhatNext(opts: WhatNextOptions): boolean {
  const env = opts.env ?? process.env;
  if (!opts.ok || opts.quiet || inCi(env)) return false;
  if (!claimFirstSuccess(opts.cwd ?? process.cwd(), env)) return false;
  const paint = createPaint(opts.color ?? colorEnabled(opts.stream, env));
  opts.stream.write(`${formatWhatNext(paint, opts.unicode ?? supportsUnicode(env))}\n\n`);
  return true;
}
