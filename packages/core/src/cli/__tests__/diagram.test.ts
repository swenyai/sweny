import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";

import { runWorkflowDiagram } from "../diagram.js";
import type { Workflow } from "../../types.js";

const sampleWorkflow: Workflow = {
  id: "sample",
  name: "Sample",
  description: "sample",
  entry: "a",
  nodes: {
    a: { name: "A", instruction: "do a", skills: [] },
    b: { name: "B", instruction: "do b", skills: [] },
  },
  edges: [{ from: "a", to: "b" }],
};

// Minimal in-memory writable stream that accumulates text. Avoids the
// overhead of real Node streams for these pure-output assertions.
function captureStream() {
  const chunks: string[] = [];
  const stream = {
    write: (chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return {
    stream,
    get text() {
      return chunks.join("");
    },
  };
}

describe("runWorkflowDiagram", () => {
  let tmpdir: string;
  const loadWorkflowFile = vi.fn((_f: string): Workflow => sampleWorkflow);
  const exit = vi.fn();

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-diagram-test-"));
    loadWorkflowFile.mockClear();
    exit.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  describe("stdout", () => {
    it("writes a fenced mermaid block to stdout by default", () => {
      const stdout = captureStream();
      const stderr = captureStream();
      runWorkflowDiagram("any.yml", {}, { loadWorkflowFile, stdout: stdout.stream, stderr: stderr.stream, exit });
      expect(stdout.text).toMatch(/^```mermaid\n/);
      expect(stdout.text).toMatch(/\n```\n$/);
      expect(exit).not.toHaveBeenCalled();
    });

    it("writes raw mermaid when --no-block is explicit", () => {
      const stdout = captureStream();
      const stderr = captureStream();
      runWorkflowDiagram(
        "any.yml",
        { block: false },
        { loadWorkflowFile, stdout: stdout.stream, stderr: stderr.stream, exit },
      );
      expect(stdout.text).not.toMatch(/```mermaid/);
      expect(stdout.text).toMatch(/graph TB/);
    });

    it("honors --direction LR", () => {
      const stdout = captureStream();
      runWorkflowDiagram(
        "any.yml",
        { direction: "LR" },
        { loadWorkflowFile, stdout: stdout.stream, stderr: captureStream().stream, exit },
      );
      expect(stdout.text).toMatch(/graph LR/);
    });

    it("honors --title override", () => {
      const stdout = captureStream();
      runWorkflowDiagram(
        "any.yml",
        { title: "Custom Title" },
        { loadWorkflowFile, stdout: stdout.stream, stderr: captureStream().stream, exit },
      );
      expect(stdout.text).toContain("Custom Title");
    });
  });

  describe("-o / --output file", () => {
    it("writes raw mermaid to .mmd by default (no fence)", () => {
      const out = path.join(tmpdir, "diagram.mmd");
      const stderr = captureStream();
      runWorkflowDiagram(
        "any.yml",
        { output: out },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: stderr.stream, exit },
      );
      const contents = fs.readFileSync(out, "utf8");
      expect(contents).not.toMatch(/```mermaid/);
      expect(contents).toMatch(/graph TB/);
      expect(stderr.text).toMatch(/✓ Wrote diagram to/);
    });

    it("writes fenced markdown to .md by default", () => {
      const out = path.join(tmpdir, "diagram.md");
      runWorkflowDiagram(
        "any.yml",
        { output: out },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: captureStream().stream, exit },
      );
      const contents = fs.readFileSync(out, "utf8");
      expect(contents).toMatch(/^```mermaid\n/);
      expect(contents).toMatch(/\n```\n$/);
    });

    it("falls back to fenced default for unknown extensions", () => {
      const out = path.join(tmpdir, "diagram.txt");
      runWorkflowDiagram(
        "any.yml",
        { output: out },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: captureStream().stream, exit },
      );
      const contents = fs.readFileSync(out, "utf8");
      expect(contents).toMatch(/```mermaid/);
    });

    it("creates parent directories as needed (-o nested/subdir/file.mmd)", () => {
      const out = path.join(tmpdir, "a", "b", "c", "diagram.mmd");
      runWorkflowDiagram(
        "any.yml",
        { output: out },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: captureStream().stream, exit },
      );
      expect(fs.existsSync(out)).toBe(true);
      expect(fs.readFileSync(out, "utf8")).toMatch(/graph TB/);
    });

    it("does not write anything to stdout when -o is set", () => {
      const stdout = captureStream();
      const out = path.join(tmpdir, "diagram.mmd");
      runWorkflowDiagram(
        "any.yml",
        { output: out },
        { loadWorkflowFile, stdout: stdout.stream, stderr: captureStream().stream, exit },
      );
      expect(stdout.text).toBe("");
    });
  });

  describe("explicit --block / --no-block precedence over extension inference", () => {
    function cmdWithBlock(block: boolean, explicit: boolean): Command {
      const cmd = new Command();
      cmd.option("--block", "fenced", true);
      cmd.option("--no-block", "raw");
      if (explicit) {
        // Simulate user typing `--block` or `--no-block` on the CLI — commander
        // marks the source as "cli" when the flag is seen in argv.
        cmd.setOptionValueWithSource("block", block, "cli");
      }
      return cmd;
    }

    it("explicit --block wins over .mmd extension (writes fenced to .mmd)", () => {
      const out = path.join(tmpdir, "diagram.mmd");
      runWorkflowDiagram(
        "any.yml",
        { output: out, block: true },
        {
          loadWorkflowFile,
          command: cmdWithBlock(true, true),
          stdout: captureStream().stream,
          stderr: captureStream().stream,
          exit,
        },
      );
      expect(fs.readFileSync(out, "utf8")).toMatch(/```mermaid/);
    });

    it("explicit --no-block wins over .md extension (writes raw to .md)", () => {
      const out = path.join(tmpdir, "diagram.md");
      runWorkflowDiagram(
        "any.yml",
        { output: out, block: false },
        {
          loadWorkflowFile,
          command: cmdWithBlock(false, true),
          stdout: captureStream().stream,
          stderr: captureStream().stream,
          exit,
        },
      );
      expect(fs.readFileSync(out, "utf8")).not.toMatch(/```mermaid/);
    });

    it("default --block source does not suppress .mmd extension inference", () => {
      // Commander always sets `block: true` via the declared default, but its
      // source is "default" — our inference should still kick in for .mmd.
      const out = path.join(tmpdir, "diagram.mmd");
      runWorkflowDiagram(
        "any.yml",
        { output: out, block: true },
        {
          loadWorkflowFile,
          command: cmdWithBlock(true, false), // not explicit
          stdout: captureStream().stream,
          stderr: captureStream().stream,
          exit,
        },
      );
      expect(fs.readFileSync(out, "utf8")).not.toMatch(/```mermaid/);
    });
  });

  describe("builtin workflow names", () => {
    it("resolves 'triage' without calling loadWorkflowFile", () => {
      const stdout = captureStream();
      runWorkflowDiagram(
        "triage",
        {},
        { loadWorkflowFile, stdout: stdout.stream, stderr: captureStream().stream, exit },
      );
      expect(loadWorkflowFile).not.toHaveBeenCalled();
      expect(stdout.text).toMatch(/```mermaid/);
    });

    it("resolves 'implement' without calling loadWorkflowFile", () => {
      const stdout = captureStream();
      runWorkflowDiagram(
        "implement",
        {},
        { loadWorkflowFile, stdout: stdout.stream, stderr: captureStream().stream, exit },
      );
      expect(loadWorkflowFile).not.toHaveBeenCalled();
      expect(stdout.text.length).toBeGreaterThan(0);
    });

    it("resolves 'seed-content' without calling loadWorkflowFile", () => {
      const stdout = captureStream();
      runWorkflowDiagram(
        "seed-content",
        {},
        { loadWorkflowFile, stdout: stdout.stream, stderr: captureStream().stream, exit },
      );
      expect(loadWorkflowFile).not.toHaveBeenCalled();
      expect(stdout.text.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("exits with code 1 and prints an error when loadWorkflowFile throws", () => {
      const stderr = captureStream();
      const throwingLoader = vi.fn(() => {
        throw new Error("file not found: missing.yml");
      });
      runWorkflowDiagram(
        "missing.yml",
        {},
        { loadWorkflowFile: throwingLoader, stdout: captureStream().stream, stderr: stderr.stream, exit },
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(stderr.text).toMatch(/file not found/);
    });

    it("exits with code 1 when the output path is unwritable", () => {
      // Point -o at a path where the parent is a file (not a dir). mkdirSync
      // with recursive:true will throw EEXIST, writeFileSync then fails. We
      // specifically want to assert the error path doesn't crash the process.
      const blocker = path.join(tmpdir, "blocker");
      fs.writeFileSync(blocker, "im-a-file");
      const out = path.join(blocker, "diagram.mmd");
      const stderr = captureStream();
      runWorkflowDiagram(
        "any.yml",
        { output: out },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: stderr.stream, exit },
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(stderr.text).toMatch(/Error:/);
    });
  });
});
