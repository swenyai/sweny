import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WHAT_NEXT_DOCS_URL,
  WHAT_NEXT_STEPS,
  claimFirstSuccess,
  firstSuccessMarker,
  formatWhatNext,
  inCi,
  writeWhatNext,
} from "./first-success.js";
import { createPaint } from "./style.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*m/;

let state: string;
let work: string;
let out: string;
const stream = () => ({ isTTY: false, write: (s: string) => void (out += s) });
const tty = () => ({ isTTY: true, write: (s: string) => void (out += s) });

beforeEach(() => {
  state = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-first-state-"));
  work = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-first-work-"));
  out = "";
});
afterEach(() => {
  fs.rmSync(state, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

const envFor = (extra: Record<string, string> = {}) => ({ SWENY_STATE_DIR: state, ...extra });

describe("formatWhatNext", () => {
  it("names history, compare and schedule, and ends on a plain docs line", () => {
    const text = formatWhatNext();
    const lines = text.split("\n");
    expect(lines[0]).toBe("  ▲ Next");
    expect(text).toContain("sweny runs  ");
    expect(text).toContain("sweny runs diff");
    expect(text).toContain("sweny new --template weekly-digest");
    expect(lines[lines.length - 1]).toBe(`  Packs and the Action: ${WHAT_NEXT_DOCS_URL}`);
  });

  it("aligns the descriptions in one column", () => {
    const rows = formatWhatNext().split("\n").slice(1, -1);
    expect(rows).toHaveLength(WHAT_NEXT_STEPS.length);
    const cols = rows.map((r, i) => r.indexOf(WHAT_NEXT_STEPS[i].what));
    expect(cols.every((c) => c > 0)).toBe(true);
    expect(new Set(cols).size).toBe(1);
  });

  it("without color carries no ANSI escapes; with color it does", () => {
    expect(formatWhatNext(createPaint(false))).not.toMatch(ANSI);
    expect(formatWhatNext(createPaint(true))).toMatch(ANSI);
  });

  it("ASCII fallback uses the ASCII brand glyph and no non-ASCII text", () => {
    const text = formatWhatNext(createPaint(false), false);
    expect(text.split("\n")[0]).toBe("  ^ Next");
    // eslint-disable-next-line no-control-regex
    expect(text).toMatch(/^[\x00-\x7F]*$/);
  });

  it("the plain text is identical with and without color once ANSI is stripped", () => {
    const colored = formatWhatNext(createPaint(true)).replace(new RegExp(ANSI.source, "g"), "");
    expect(colored).toBe(formatWhatNext(createPaint(false)));
  });
});

describe("writeWhatNext", () => {
  it("prints once per workspace, then stays silent", () => {
    const env = envFor();
    expect(writeWhatNext({ stream: stream(), ok: true, env, cwd: work, color: false })).toBe(true);
    expect(out).toContain("sweny runs diff");
    expect(out.endsWith(`${WHAT_NEXT_DOCS_URL}\n\n`)).toBe(true);
    const first = out;
    expect(writeWhatNext({ stream: stream(), ok: true, env, cwd: work, color: false })).toBe(false);
    expect(out).toBe(first);
  });

  it("a different workspace gets its own first-run note", () => {
    const env = envFor();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-first-other-"));
    try {
      expect(writeWhatNext({ stream: stream(), ok: true, env, cwd: work })).toBe(true);
      expect(writeWhatNext({ stream: stream(), ok: true, env, cwd: other })).toBe(true);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("keeps the marker in the state dir, never in the workspace", () => {
    const env = envFor();
    writeWhatNext({ stream: stream(), ok: true, env, cwd: work });
    expect(fs.existsSync(firstSuccessMarker(work, env))).toBe(true);
    expect(firstSuccessMarker(work, env).startsWith(state)).toBe(true);
    expect(fs.readdirSync(work)).toEqual([]);
  });

  it("is silent in CI and does not use up the marker", () => {
    for (const ci of [{ CI: "true" }, { CI: "1" }, { GITHUB_ACTIONS: "true" }]) {
      const env = envFor(ci);
      expect(inCi(env)).toBe(true);
      expect(writeWhatNext({ stream: stream(), ok: true, env, cwd: work })).toBe(false);
    }
    expect(out).toBe("");
    expect(fs.existsSync(firstSuccessMarker(work, envFor()))).toBe(false);
    expect(writeWhatNext({ stream: stream(), ok: true, env: envFor(), cwd: work })).toBe(true);
  });

  it("CI=false and CI=0 are not CI", () => {
    expect(inCi({ CI: "false" })).toBe(false);
    expect(inCi({ CI: "0" })).toBe(false);
    expect(inCi({})).toBe(false);
  });

  it("is silent for a failed run, and the marker survives for the first success", () => {
    const env = envFor();
    expect(writeWhatNext({ stream: stream(), ok: false, env, cwd: work })).toBe(false);
    expect(out).toBe("");
    expect(writeWhatNext({ stream: stream(), ok: true, env, cwd: work })).toBe(true);
  });

  it("is silent when the run's stdout is data or nothing real ran (quiet)", () => {
    const env = envFor();
    expect(writeWhatNext({ stream: stream(), ok: true, quiet: true, env, cwd: work })).toBe(false);
    expect(out).toBe("");
    expect(fs.existsSync(firstSuccessMarker(work, env))).toBe(false);
  });

  it("NO_COLOR on a TTY: the same words, no escapes, plain last line", () => {
    const env = envFor({ NO_COLOR: "1" });
    expect(writeWhatNext({ stream: tty(), ok: true, env, cwd: work })).toBe(true);
    expect(out).not.toMatch(ANSI);
    expect(out.trimEnd().split("\n").pop()).toBe(`  Packs and the Action: ${WHAT_NEXT_DOCS_URL}`);
  });

  it("a TTY with color gets painted output; a pipe does not", () => {
    const colored = writeWhatNext({ stream: tty(), ok: true, env: envFor({ FORCE_COLOR: "1" }), cwd: work });
    expect(colored).toBe(true);
    expect(out).toMatch(ANSI);
    out = "";
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-first-pipe-"));
    try {
      writeWhatNext({ stream: stream(), ok: true, env: envFor(), cwd: other });
      expect(out).not.toMatch(ANSI);
      expect(out).toContain("sweny runs");
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("stays silent (no repeat risk) when the marker cannot be written", () => {
    const blocker = path.join(state, "file-not-dir");
    fs.writeFileSync(blocker, "");
    const env = { SWENY_STATE_DIR: blocker };
    expect(claimFirstSuccess(work, env)).toBe(false);
    expect(writeWhatNext({ stream: stream(), ok: true, env, cwd: work })).toBe(false);
    expect(out).toBe("");
  });

  it("claims atomically: the second claim of one workspace loses", () => {
    const env = envFor();
    expect(claimFirstSuccess(work, env)).toBe(true);
    expect(claimFirstSuccess(work, env)).toBe(false);
  });
});

describe("wiring", () => {
  const main = fs.readFileSync(path.join(here, "main.ts"), "utf-8");

  it("only the real workflow run prints it; sweny try never does", () => {
    const tryTs = fs.readFileSync(path.join(here, "try.ts"), "utf-8");
    expect(tryTs).not.toMatch(/first-success|writeWhatNext/);
    expect(main).toMatch(/writeWhatNext\(\{/);
    expect(main.match(/writeWhatNext\(/g)).toHaveLength(1);
  });

  it("is called after the success receipt, on stdout", () => {
    const receipt = main.indexOf(
      "await writeReceipt(receipt, { workflow: workflow.id, runId, stream: process.stdout })",
    );
    const next = main.indexOf("writeWhatNext({");
    expect(receipt).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(receipt);
  });

  it("every command in the note is a registered subcommand", () => {
    const runs = fs.readFileSync(path.join(here, "runs.ts"), "utf-8");
    expect(runs).toMatch(/\.command\("runs"\)/);
    expect(runs).toMatch(/\.command\("diff \[a\] \[b\]"\)/);
    expect(main).toMatch(/\.command\("new \[id\]"\)/);
    const packs = fs.readFileSync(path.join(here, "packs.ts"), "utf-8");
    expect(packs).toContain('id: "weekly-digest"');
  });
});
