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
  createReplayHarness,
  loadTryFixture,
  loadTryWorkflow,
  parseTryFixture,
  runTry,
} from "./try.js";

const here = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
});

async function capture(opts: Parameters<typeof runTry>[0] = {}) {
  let out = "";
  const code = await runTry({ fast: true, tty: false, unicode: true, write: (s) => (out += s), ...opts });
  return { code, out };
}

describe("try fixture", () => {
  it("is valid, labelled illustrative, and matches the explain-repo template", () => {
    const fixture = loadTryFixture();
    expect(fixture.illustrative).toBe(true);
    expect(fixture.notice).toContain("ILLUSTRATIVE");
    const wf = loadTryWorkflow(fixture.workflow);
    for (const id of Object.keys(fixture.nodes)) expect(wf.nodes[id]).toBeDefined();
    expect(Object.keys(fixture.nodes)).toEqual(["survey", "explain"]);
  });

  it("holds metadata plus the sample answer only", () => {
    const raw = fs.readFileSync(path.join(here, "try-fixture.json"), "utf-8");
    const fixture = JSON.parse(raw) as Record<string, any>;
    for (const node of Object.values<any>(fixture.nodes)) {
      expect(Object.keys(node).sort().join()).toMatch(
        /^(duration_ms,output,tool_calls,usage|duration_ms,tool_calls,usage)$/,
      );
    }
  });

  it("rejects a malformed fixture", () => {
    expect(() => parseTryFixture(null)).toThrow(/expected an object/);
    expect(() => parseTryFixture({ ...loadTryFixture(), nodes: {} })).toThrow(/nodes/);
    expect(() => parseTryFixture({ ...loadTryFixture(), illustrative: "yes" })).toThrow(/illustrative/);
  });

  it("the shipped help note says illustrative", () => {
    expect(TRY_HELP_NOTE).toContain("ILLUSTRATIVE");
  });
});

describe("replay harness", () => {
  it("plays recordings in order and reports counts, usage and policy", async () => {
    const fixture = loadTryFixture();
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

  it("routing and judging fail closed", async () => {
    const h = createReplayHarness(loadTryFixture(), { paceMs: 0 });
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
    // a compact comment preview: heading and the DAG, not raw markdown
    expect(out).toContain("CI posts");
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
