import { describe, it, expect, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SWENY_TAGLINE } from "../theme.js";
import {
  TRY_BANNER_TITLE,
  TRY_HELP_NOTE,
  TRY_NEXT_COMMAND,
  compactAnswer,
  createReplayHarness,
  loadTryFixture,
  loadTryWorkflow,
  formatTryBanner,
  parseTryFixture,
  REPLAY_NODE_MIN_MS,
  REPLAY_TARGET_MS,
  runTry,
  scaledPace,
  tryHelpNote,
  tryLabel,
  type TryFixture,
} from "./try.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Behavior specs run on test-local fixtures, never on the shipped try-fixture.json, so replacing the
// recording (a new capture, a new repo) cannot break them. The shipped file gets one invariants spec.
const fixtureFile = (name: string) => path.join(here, "test-fixtures", name);
const illustrativeFixture = (): TryFixture => loadTryFixture(fixtureFile("try-illustrative.json"));
const realFixtureBase = (): TryFixture => loadTryFixture(fixtureFile("try-real.json"));

afterEach(() => {
  vi.restoreAllMocks();
});

async function capture(opts: Parameters<typeof runTry>[0] = {}) {
  let out = "";
  const code = await runTry({
    fast: true,
    tty: false,
    unicode: true,
    fixture: illustrativeFixture(),
    write: (s) => (out += s),
    ...opts,
  });
  return { code, out };
}

// Secret-shaped strings that must never ship in the recording.
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /(password|secret|token|api[_-]?key)["']?\s*[:=]\s*["'][^"']{8,}/i,
];

describe("the shipped try-fixture.json (invariants only)", () => {
  it("is a valid real capture of the explain-repo template, dated, and carries no secret-looking strings", () => {
    const raw = fs.readFileSync(path.join(here, "try-fixture.json"), "utf-8");
    const fixture = parseTryFixture(JSON.parse(raw));
    expect(fixture.illustrative).toBe(false);
    expect(fixture.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fixture.notice).not.toMatch(/ILLUSTRATIVE/);
    const wf = loadTryWorkflow(fixture.workflow);
    expect(Object.keys(fixture.nodes)).toEqual(["survey", "explain"]);
    for (const id of Object.keys(fixture.nodes)) expect(wf.nodes[id]).toBeDefined();
    // Metadata plus the answer only: no tool inputs or outputs.
    for (const node of Object.values(fixture.nodes)) {
      expect(Object.keys(node).sort().join()).toMatch(
        /^(duration_ms,output,tool_calls,usage|duration_ms,tool_calls,usage)$/,
      );
    }
    for (const re of SECRET_SHAPES) expect(raw, String(re)).not.toMatch(re);
  });
});

describe("test fixtures", () => {
  it("are valid; one is illustrative, one is a dated real capture, both match the template", () => {
    const ill = illustrativeFixture();
    const real = realFixtureBase();
    expect(ill.illustrative).toBe(true);
    expect(ill.notice).toContain("ILLUSTRATIVE");
    expect(real.illustrative).toBe(false);
    expect(real.captured_at).toBeDefined();
    for (const f of [ill, real]) {
      const wf = loadTryWorkflow(f.workflow);
      expect(Object.keys(f.nodes)).toEqual(["survey", "explain"]);
      for (const id of Object.keys(f.nodes)) expect(wf.nodes[id]).toBeDefined();
    }
  });

  it("rejects a malformed fixture", () => {
    expect(() => parseTryFixture(null)).toThrow(/expected an object/);
    expect(() => parseTryFixture({ ...illustrativeFixture(), nodes: {} })).toThrow(/nodes/);
    expect(() => parseTryFixture({ ...illustrativeFixture(), illustrative: "yes" })).toThrow(/illustrative/);
  });

  it("the illustrative help note says illustrative", () => {
    expect(TRY_HELP_NOTE).toContain("ILLUSTRATIVE");
  });
});

const realFixture = (over: Partial<TryFixture> = {}): TryFixture => ({ ...realFixtureBase(), ...over });

describe("label follows `illustrative` (#537)", () => {
  it("illustrative: the sample-repo wording, no date", () => {
    const f = illustrativeFixture();
    expect(tryLabel(f)).toContain("illustrative data");
    expect(tryLabel(f)).not.toContain("real run");
    expect(tryHelpNote(f)).toBe(TRY_HELP_NOTE);
    expect(formatTryBanner(f)).toContain("on a sample repo (acme-notes-api), illustrative data");
  });

  it("real: says replay of a real run on <date>, names the repo, never says illustrative", () => {
    const f = realFixture();
    expect(tryLabel(f)).toBe("of explain-repo on acme/widget-service, a replay of a real run on 2026-11-12");
    const banner = formatTryBanner(f);
    expect(banner).toContain(
      "Recorded demo of explain-repo on acme/widget-service, a replay of a real run on 2026-11-12.",
    );
    expect(banner).not.toMatch(/illustrative|sample repo/i);
    expect(tryHelpNote(f)).toContain("replay of a real run");
    expect(tryHelpNote(f)).not.toMatch(/ILLUSTRATIVE|made-up|hand-written/);
  });

  it("runTry prints the real label on the second line", async () => {
    const { out } = await capture({ fixture: realFixture() });
    const lines = out.split("\n");
    expect(lines[2]).toContain("a replay of a real run on 2026-11-12");
    expect(out).not.toContain("illustrative");
  });

  it("a real fixture must carry captured_at; a bad one is rejected", () => {
    const noDate: Partial<TryFixture> = realFixture();
    delete noDate.captured_at;
    expect(() => parseTryFixture(noDate)).toThrow(/captured_at/);
    expect(() => parseTryFixture({ ...realFixture(), captured_at: "yesterday" })).toThrow(/captured_at/);
    expect(parseTryFixture(realFixture()).captured_at).toBe("2026-11-12T14:00:00.000Z");
    // an illustrative fixture needs no date
    expect(() => parseTryFixture(illustrativeFixture())).not.toThrow();
  });
});

describe("replay pacing (#537)", () => {
  it("scales recorded timings to the target total, proportionally, and never slows a short run", () => {
    const long = realFixture({
      nodes: {
        survey: { duration_ms: 90_000, tool_calls: {} },
        explain: { duration_ms: 30_000, tool_calls: {} },
      },
    });
    const pace = scaledPace(long);
    expect(pace("survey") + pace("explain")).toBe(REPLAY_TARGET_MS);
    expect(pace("survey")).toBe(pace("explain") * 3);
    const short = realFixture({
      nodes: { survey: { duration_ms: 2000, tool_calls: {} }, explain: { duration_ms: 10, tool_calls: {} } },
    });
    expect(scaledPace(short)("survey")).toBe(2000);
    expect(scaledPace(short)("explain")).toBe(REPLAY_NODE_MIN_MS);
  });

  it("default replay is instant off a live terminal (non-TTY) and under CI; an explicit pace still applies", async () => {
    const t0 = Date.now();
    await capture({ fast: false });
    expect(Date.now() - t0).toBeLessThan(2000);
    const prev = { CI: process.env.CI, TERM: process.env.TERM };
    process.env.CI = "true";
    try {
      const t1 = Date.now();
      await capture({ fast: false, tty: true, columns: 80 });
      expect(Date.now() - t1).toBeLessThan(2000);
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("honors NO_COLOR: no ANSI escapes in a non-TTY replay of a real fixture", async () => {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const { out } = await capture({ fixture: realFixture() });
      expect(out).not.toMatch(/\x1B\[[0-9;]*m/);
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  });
});

describe("replay harness", () => {
  it("plays recordings in order and reports counts, usage and policy", async () => {
    const fixture = illustrativeFixture();
    const h = createReplayHarness(fixture, { paceMs: 0 });
    const progress: string[] = [];
    const first = await h.run({
      instruction: "x",
      context: {},
      tools: [],
      onProgress: (m: string) => progress.push(m),
    } as never);
    expect(first.status).toBe("success");
    expect(first.toolCalls).toHaveLength(12);
    expect(progress).toHaveLength(12);
    expect(first.usage?.inputTokens).toBe(21300);
    expect(first.policy).toEqual({ envScope: true, sandbox: "auto", sandboxStarted: true });
    const second = await h.run({ instruction: "y", context: {}, tools: [] } as never);
    expect((second.data as Record<string, unknown>).purpose).toEqual(expect.any(String));
    const third = await h.run({ instruction: "z", context: {}, tools: [] } as never);
    expect(third.status).toBe("failed");
  });

  it("replays a real fixture the same way: its own counts, usage and policy", async () => {
    const h = createReplayHarness(realFixture(), { paceMs: 0 });
    const progress: string[] = [];
    const first = await h.run({
      instruction: "x",
      context: {},
      tools: [],
      onProgress: (m: string) => progress.push(m),
    } as never);
    expect(first.toolCalls.map((c) => c.tool)).toEqual(["Bash", "Bash", "Bash", "Bash", "Read", "Read"]);
    expect(progress).toHaveLength(6);
    expect(first.usage?.inputTokens).toBe(1000);
    expect(first.policy).toEqual({ envScope: true, sandbox: "strict", sandboxStarted: true });
    expect(first.harness).toEqual({ id: "claude-code", version: "0.0.0-test" });
    const second = await h.run({ instruction: "y", context: {}, tools: [] } as never);
    expect(second.toolCalls).toEqual([{ tool: "StructuredOutput", input: {} }]);
    expect((second.data as Record<string, unknown>).how_to_run).toHaveLength(6);
  });

  it("routing and judging fail closed", async () => {
    const h = createReplayHarness(illustrativeFixture(), { paceMs: 0 });
    expect(await h.complete({ prompt: "p" })).toBeNull();
  });
});

describe("runTry", () => {
  it("prints tagline, progress, answer, comment preview, receipt with policy and one next command; exits 0", async () => {
    const { code, out } = await capture();
    expect(code).toBe(0);
    // leads with the tagline; the demo notice is the second line
    const lines = out.split("\n");
    expect(lines[1]).toContain(SWENY_TAGLINE);
    expect(lines[2]).toContain(TRY_BANNER_TITLE);
    expect(lines[2]).toContain("illustrative");
    expect(out).toContain("✓ survey");
    expect(out).toContain("✓ explain");
    // the answer block, from the real renderer (field titles from the template schema)
    expect(out).toContain("What it is:");
    expect(out).toContain("How to run it:");
    expect(out).toContain("Key files:");
    expect(out).toContain("Watch out for:");
    // the receipt line, from the real formatter, with the policy segment
    expect(out).toContain("✓ 2/2 nodes · 12 tool calls · 28s · 30k tokens · $0.13 · policy: env scoped, sandbox on");
    // a compact job summary preview: heading and the DAG, not raw markdown
    expect(out).toContain("the job summary gets this heading");
    expect(out).toContain("✓ Explain This Repo");
    expect(out).toContain("┌");
    expect(out).not.toContain("<!-- sweny-run-comment");
    expect(out).not.toContain("| --- |");
    expect(out).not.toContain("```");
    // ends on the receipt plus one next command
    const tail = out.trimEnd().split("\n");
    expect(tail[tail.length - 1]).toContain(TRY_NEXT_COMMAND);
    expect(tail[tail.length - 3]).toContain("2/2 nodes");
    // the answer comes above the receipt
    expect(out.indexOf("What it is:")).toBeLessThan(out.indexOf("2/2 nodes"));
    expect(out).not.toContain("\u2014");
  });

  it("a real fixture: its own counts and policy on the receipt, the full answer, no illustrative wording", async () => {
    const { code, out } = await capture({ fixture: realFixture() });
    expect(code).toBe(0);
    expect(out).toContain("✓ 2/2 nodes · 7 tool calls · 18s · ");
    expect(out).toContain("policy: env scoped, sandbox on");
    expect(out).not.toMatch(/illustrative/i);
    // the whole answer, every item of every list
    expect(out).toContain("How to run it:");
    expect(out).toContain("npm start (serves on port 8080)");
    expect(out).toContain("Dockerfile: the production image");
    expect(out).toContain("Migrations run on start, so two replicas can race.");
    expect(out).not.toMatch(/\(\d+ of \d+\):/);
  });

  it("compactAnswer: a summary of the answer (first items, count in the heading); unset shows it all", async () => {
    const { out } = await capture({ fixture: realFixture(), compactAnswer: 2 });
    expect(out).toContain("What it is: Widget Service stores and serves widgets over HTTP.");
    expect(out).toContain("How to run it (2 of 6):");
    expect(out).toContain("Key files (2 of 7):");
    expect(out).toContain("Watch out for (2 of 4):");
    expect(out).toContain("- npm run build");
    expect(out).not.toContain("npm run typecheck");
    expect(out).not.toContain("Dockerfile");
    expect(out).not.toContain("Migrations run on start");
    // the receipt and the next command are untouched
    expect(out).toContain("✓ 2/2 nodes · 7 tool calls");
    expect(out.trimEnd().split("\n").pop()).toContain(TRY_NEXT_COMMAND);
  });

  it("on a TTY: spinner per node, then ends on the ticket with the stamp and one next command", async () => {
    const prev = { NO_COLOR: process.env.NO_COLOR, CI: process.env.CI };
    process.env.NO_COLOR = "1";
    delete process.env.CI;
    try {
      const { code, out } = await capture({ tty: true, fast: false, paceMs: 200, columns: 80 });
      expect(code).toBe(0);
      expect(out).toMatch(/\r\x1B\[2K {2}[\u2800-\u28FF] survey/);
      expect(out).toContain("[ ENV SCOPED · SANDBOXED ]");
      expect(out).toContain("╭");
      expect(out).not.toContain("✓ 2/2 nodes ·");
      expect(out.trimEnd().split("\n").pop()).toContain(TRY_NEXT_COMMAND);
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("makes no network call, reads no credentials, writes no files", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network is off"));
    const mkdir = vi.spyOn(fs, "mkdirSync");
    const write = vi.spyOn(fs, "writeFileSync");
    const append = vi.spyOn(fs, "appendFileSync");
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-SENTINEL";
    try {
      const { code, out } = await capture();
      expect(code).toBe(0);
      expect(out).not.toContain("SENTINEL");
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("--comment-file writes the PR comment markdown", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-try-"));
    try {
      const file = path.join(dir, "comment.md");
      await capture({ commentFile: file });
      const md = fs.readFileSync(file, "utf-8");
      expect(md).toContain("<!-- sweny-run-comment:explain-repo -->");
      expect(md).toContain("```mermaid");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("paces the replay unless fast", async () => {
    const t0 = Date.now();
    await capture({ fast: false, paceMs: 60 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    const t1 = Date.now();
    await capture({ fast: true, paceMs: 5000 });
    expect(Date.now() - t1).toBeLessThan(2000);
  });
});

// Through the built CLI, in an empty dir with an empty env: no .sweny/ appears.
const CLI_BIN = path.resolve(here, "..", "..", "dist", "cli", "main.js");
describe.skipIf(!fs.existsSync(CLI_BIN))("sweny try (built CLI)", () => {
  it("runs with an empty environment, exits 0 and leaves the directory untouched", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-try-cwd-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-try-home-"));
    try {
      const r = spawnSync("node", [CLI_BIN, "try", "--fast"], {
        cwd,
        encoding: "utf-8",
        timeout: 30_000,
        env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1", FORCE_COLOR: "0" },
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(TRY_BANNER_TITLE);
      expect(r.stdout).toContain("✓ 2/2 nodes");
      expect(fs.readdirSync(cwd)).toEqual([]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("compactAnswer", () => {
  const out = (lines: string[], kind: "result" | "error" = "result") => ({ kind, node: "explain", lines });
  const answer = out([
    "What it is: A thing.",
    "Steps:",
    "- one",
    "- two, which wraps",
    "  onto a second line",
    "- three",
    "Files:",
    "- a",
    "- b",
    "Notes:",
    "  free text under a heading",
  ]);

  it("cuts each list to the first N items, keeps wrapped continuations, and counts in the heading", () => {
    expect(compactAnswer(answer, 2).lines).toEqual([
      "What it is: A thing.",
      "Steps (2 of 3):",
      "- one",
      "- two, which wraps",
      "  onto a second line",
      "Files:",
      "- a",
      "- b",
      "Notes:",
      "  free text under a heading",
    ]);
    expect(compactAnswer(answer, 1).lines).toContain("Steps (1 of 3):");
    expect(compactAnswer(answer, 1).lines).toContain("Files (1 of 2):");
  });

  it("leaves lists within the limit, scalars and headings with text alone; keeps the rest of the answer", () => {
    expect(compactAnswer(answer, 3).lines).toEqual(answer.lines);
    expect(compactAnswer({ ...answer, node: "x" }, 2).node).toBe("x");
  });

  it("never touches an error, and ignores a limit that is not a positive integer", () => {
    const err = out(["Steps:", "- one", "- two", "- three"], "error");
    expect(compactAnswer(err, 1)).toBe(err);
    expect(compactAnswer(answer, 0)).toBe(answer);
    expect(compactAnswer(answer, 1.5)).toBe(answer);
  });
});
