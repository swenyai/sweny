/**
 * Files sweny writes into the agent-writable workspace never follow a link.
 *
 * The cheapest falsifier: an agent plants `.sweny/runs/<id>/output.md` as a
 * symlink (or hard link) to a file outside the workspace; sweny's write must
 * leave that file untouched. Real filesystem, temp dirs only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertOpenedUnder, ensureDirNoFollow, openNoFollow, workspaceRoot, writeFileNoFollow } from "./safe-file.js";
import { outputRelPath, writeFinalOutput } from "./cli/final-output.js";
import { writeStepSummary, summarizeRun } from "./cli/run-output.js";
import { writeRunRecord, type RunRecord } from "./cli/run-history.js";
import { JOURNAL_FILE, RunJournal, journalDir } from "./journal.js";
import { execute } from "./executor.js";
import type { Claude, NodeResult, Workflow } from "./types.js";

const posix = process.platform !== "win32";
const RUN_ID = "20260930-101500-abc123";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-nofollow-"));
  dirs.push(d);
  return d;
}

/** A workspace and, beside it, a file the agent wants overwritten. */
function setup() {
  const root = tmp();
  const ws = path.join(root, "ws");
  fs.mkdirSync(ws);
  const victim = path.join(root, "bashrc");
  fs.writeFileSync(victim, "original\n", { mode: 0o644 });
  return {
    root,
    ws,
    victim,
    read: () => fs.readFileSync(victim, "utf-8"),
    mode: () => fs.statSync(victim).mode & 0o777,
  };
}

describe.skipIf(!posix)("output.md never follows an agent-planted link", () => {
  it("a symlinked output.md: the target is untouched, output.md becomes a fresh 0600 file", () => {
    const s = setup();
    const file = path.join(s.ws, outputRelPath(RUN_ID));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.symlinkSync(s.victim, file);
    expect(writeFinalOutput(RUN_ID, "agent answer\n", s.ws)).toBe(outputRelPath(RUN_ID));
    expect(s.read()).toBe("original\n");
    expect(s.mode()).toBe(0o644);
    const st = fs.lstatSync(file);
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, "utf-8")).toBe("agent answer\n");
  });

  it("a hard-linked output.md: the other link is untouched", () => {
    const s = setup();
    const file = path.join(s.ws, outputRelPath(RUN_ID));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.linkSync(s.victim, file);
    expect(writeFinalOutput(RUN_ID, "agent answer\n", s.ws)).not.toBeNull();
    expect(s.read()).toBe("original\n");
    expect(fs.readFileSync(file, "utf-8")).toBe("agent answer\n");
  });

  it.each([
    ["the run dir", (ws: string) => path.join(ws, ".sweny", "runs", RUN_ID)],
    ["the runs dir", (ws: string) => path.join(ws, ".sweny", "runs")],
    [".sweny", (ws: string) => path.join(ws, ".sweny")],
  ])("%s is a symlink out of the workspace: nothing is written", (_l, at) => {
    const s = setup();
    const outside = path.join(s.root, "outside");
    fs.mkdirSync(outside);
    const link = at(s.ws);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link);
    expect(writeFinalOutput(RUN_ID, "agent answer\n", s.ws)).toBeNull();
    const found: string[] = [];
    const walk = (d: string) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        found.push(p);
        if (fs.lstatSync(p).isDirectory()) walk(p);
      }
    };
    walk(outside);
    expect(found).toEqual([]);
  });

  it("a clean workspace still gets output.md", () => {
    const s = setup();
    expect(writeFinalOutput(RUN_ID, "x", s.ws)).toBe(outputRelPath(RUN_ID));
    expect(fs.readFileSync(path.join(s.ws, outputRelPath(RUN_ID)), "utf-8")).toBe("x");
  });
});

describe.skipIf(!posix)("openNoFollow and friends", () => {
  it("append mode refuses a symlink, a hard link and a FIFO, and appends to a regular file", () => {
    const s = setup();
    const link = path.join(s.ws, "summary.md");
    fs.symlinkSync(s.victim, link);
    expect(() => writeFileNoFollow(link, "x", { root: s.ws, append: true })).toThrow();
    fs.unlinkSync(link);
    fs.linkSync(s.victim, link);
    expect(() => writeFileNoFollow(link, "x", { root: s.ws, append: true })).toThrow(/links/);
    expect(s.read()).toBe("original\n");
    fs.unlinkSync(link);
    fs.writeFileSync(link, "a\n");
    writeFileNoFollow(link, "b\n", { root: s.ws, append: true });
    expect(fs.readFileSync(link, "utf-8")).toBe("a\nb\n");
  });

  it("ensureDirNoFollow creates private dirs and refuses a symlinked component", () => {
    const s = setup();
    ensureDirNoFollow(path.join(s.ws, "a", "b"), s.ws);
    expect(fs.statSync(path.join(s.ws, "a", "b")).mode & 0o777).toBe(0o700);
    fs.symlinkSync(s.root, path.join(s.ws, "c"));
    expect(() => ensureDirNoFollow(path.join(s.ws, "c", "d"), s.ws)).toThrow(/symlink/);
    expect(fs.existsSync(path.join(s.root, "d"))).toBe(false);
  });

  it("returns a descriptor on a fresh file with the requested mode", () => {
    const s = setup();
    const fd = openNoFollow(path.join(s.ws, "f"), { root: s.ws, mode: 0o640 });
    try {
      expect(fs.fstatSync(fd).mode & 0o777).toBe(0o640);
    } finally {
      fs.closeSync(fd);
    }
  });

  it("replace mode keeps a plain file's inode and truncates it through the descriptor", () => {
    const s = setup();
    const file = path.join(s.ws, "out.md");
    fs.writeFileSync(file, "a much longer previous body\n");
    const ino = fs.lstatSync(file).ino;
    writeFileNoFollow(file, "new\n", { root: s.ws });
    expect(fs.readFileSync(file, "utf-8")).toBe("new\n");
    expect(fs.lstatSync(file).ino).toBe(ino);
    expect(fs.lstatSync(file).mode & 0o777).toBe(0o600);
  });

  it("replace mode replaces a FIFO without blocking", () => {
    const s = setup();
    const file = path.join(s.ws, "out.md");
    if (spawnSync("mkfifo", [file]).status !== 0) return;
    writeFileNoFollow(file, "x", { root: s.ws });
    expect(fs.lstatSync(file).isFile()).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("x");
  });

  describe("post-open verification (the directory-swap race)", () => {
    // Node has no openat(2), so a swap between the parent check and the open
    // cannot be ordered deterministically here. These drive the check that runs
    // after every open with the two states such a swap leaves behind.
    it("a parent that is a link out of the workspace after the open fails closed", () => {
      const s = setup();
      const outside = path.join(s.root, "outside");
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "f"), "victim\n");
      fs.symlinkSync(outside, path.join(s.ws, "d"));
      // The descriptor an open through the swapped directory would hold.
      const fd = fs.openSync(path.join(outside, "f"), "r+");
      try {
        expect(() => assertOpenedUnder(fd, path.join(s.ws, "d", "f"), s.ws)).toThrow(/moved during the open/);
      } finally {
        fs.closeSync(fd);
      }
      expect(fs.readFileSync(path.join(outside, "f"), "utf-8")).toBe("victim\n");
    });

    it("a directory swapped back after the open (another inode at the path) fails closed", () => {
      const s = setup();
      fs.mkdirSync(path.join(s.ws, "d"));
      const file = path.join(s.ws, "d", "f");
      fs.writeFileSync(file, "");
      const fd = fs.openSync(file, "r+");
      try {
        fs.renameSync(file, path.join(s.ws, "d", "moved"));
        fs.writeFileSync(file, "");
        expect(() => assertOpenedUnder(fd, file, s.ws)).toThrow(/changed during the open/);
      } finally {
        fs.closeSync(fd);
      }
    });

    it("the file the path names, under real directories, passes", () => {
      const s = setup();
      fs.mkdirSync(path.join(s.ws, "d"));
      const file = path.join(s.ws, "d", "f");
      fs.writeFileSync(file, "");
      const fd = fs.openSync(file, "r+");
      try {
        expect(() => assertOpenedUnder(fd, file, s.ws)).not.toThrow();
      } finally {
        fs.closeSync(fd);
      }
    });
  });

  it("workspaceRoot: inside the workspace pins the root, outside does not", () => {
    expect(workspaceRoot("a/b.md", "/w")).toEqual({ root: path.resolve("/w") });
    expect(workspaceRoot("/elsewhere/b.md", "/w")).toEqual({});
    expect(workspaceRoot("../b.md", "/w")).toEqual({});
  });
});

describe.skipIf(!posix)("other workspace files", () => {
  const workflow = { id: "w", name: "W", description: "", entry: "a", edges: [], nodes: {} } as unknown as Workflow;

  it("GITHUB_STEP_SUMMARY that is a symlink is refused, its target untouched", () => {
    const s = setup();
    const link = path.join(s.ws, "summary.md");
    fs.symlinkSync(s.victim, link);
    const results = new Map<string, NodeResult>();
    const err = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      expect(
        writeStepSummary(workflow, results, summarizeRun(results, 1), undefined, { GITHUB_STEP_SUMMARY: link }),
      ).toBe(false);
    } finally {
      process.stderr.write = err;
    }
    expect(s.read()).toBe("original\n");
  });

  it("a run record is not written through a symlinked runs dir", () => {
    const s = setup();
    const outside = path.join(s.root, "outside");
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(s.ws, ".sweny"));
    fs.symlinkSync(outside, path.join(s.ws, ".sweny", "runs"));
    const record = { run_id: RUN_ID } as unknown as RunRecord;
    expect(writeRunRecord(record, s.ws)).toBeNull();
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("the run journal does not append through a symlinked journal file", async () => {
    const s = setup();
    const dir = journalDir(s.ws, RUN_ID);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.symlinkSync(s.victim, path.join(dir, JOURNAL_FILE));
    const keyDir = path.join(s.root, "keys");
    const journal = RunJournal.create({
      runId: RUN_ID,
      cwd: s.ws,
      workflowFile: "wf.yml",
      keyDir,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    const claude: Claude = {
      async run() {
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate(o) {
        return o.choices[0].id;
      },
      async ask() {
        return "";
      },
    };
    const wf: Workflow = {
      id: "t",
      name: "T",
      description: "",
      entry: "a",
      edges: [],
      nodes: { a: { name: "A", instruction: "x", skills: [] } },
    };
    await execute(wf, {}, { skills: new Map(), claude, cwd: s.ws, journal });
    journal.end("success");
    expect(journal.active).toBe(false);
    expect(s.read()).toBe("original\n");
  });
});
