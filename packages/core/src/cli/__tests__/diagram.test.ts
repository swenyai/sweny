import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runWorkflowDiagram, resolveUseBlock } from "../diagram.js";
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

describe("resolveUseBlock", () => {
  // Centralized behavior test — the renderer is a tiny switch around this
  // so keeping the rules here as one table makes the policy easy to audit.
  it("returns false by default (stdout, no -o, no flags)", () => {
    expect(resolveUseBlock({})).toBe(false);
  });

  it("returns true when --block is explicit", () => {
    expect(resolveUseBlock({ block: true })).toBe(true);
  });

  it("returns false when --no-block is explicit, even for .md", () => {
    expect(resolveUseBlock({ block: false, output: "diagram.md" })).toBe(false);
  });

  it("infers true for .md output", () => {
    expect(resolveUseBlock({ output: "diagram.md" })).toBe(true);
  });

  it("infers true for .markdown output", () => {
    expect(resolveUseBlock({ output: "diagram.markdown" })).toBe(true);
  });

  it("infers false for .mmd output", () => {
    expect(resolveUseBlock({ output: "diagram.mmd" })).toBe(false);
  });

  it("infers false for .mermaid output", () => {
    expect(resolveUseBlock({ output: "diagram.mermaid" })).toBe(false);
  });

  it("infers false for any other extension (.txt, no ext, etc.)", () => {
    expect(resolveUseBlock({ output: "diagram.txt" })).toBe(false);
    expect(resolveUseBlock({ output: "diagram" })).toBe(false);
  });

  it("is case-insensitive on extension", () => {
    expect(resolveUseBlock({ output: "Diagram.MD" })).toBe(true);
    expect(resolveUseBlock({ output: "Diagram.MMD" })).toBe(false);
  });

  it("lets explicit --block override .mmd extension", () => {
    expect(resolveUseBlock({ block: true, output: "diagram.mmd" })).toBe(true);
  });
});

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

  describe("stdout — default behavior", () => {
    it("writes RAW mermaid (no fence, no title frontmatter) by default", () => {
      // This is the Mermaid-CLI / Live-Editor-compatible output. No ```,
      // no `---\ntitle: …\n---` — just `graph TB` and the nodes.
      const stdout = captureStream();
      const stderr = captureStream();
      runWorkflowDiagram("any.yml", {}, { loadWorkflowFile, stdout: stdout.stream, stderr: stderr.stream, exit });
      expect(stdout.text).not.toMatch(/```mermaid/);
      expect(stdout.text).not.toMatch(/^---\ntitle:/);
      expect(stdout.text).toMatch(/^graph TB/);
      expect(exit).not.toHaveBeenCalled();
    });

    it("wraps in a ```mermaid fence when --block is explicit", () => {
      const stdout = captureStream();
      runWorkflowDiagram(
        "any.yml",
        { block: true },
        { loadWorkflowFile, stdout: stdout.stream, stderr: captureStream().stream, exit },
      );
      expect(stdout.text).toMatch(/^```mermaid\n/);
      expect(stdout.text).toMatch(/\n```\n$/);
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

    it("emits --title as frontmatter only when explicitly set", () => {
      const stdout = captureStream();
      runWorkflowDiagram(
        "any.yml",
        { title: "Custom Title" },
        { loadWorkflowFile, stdout: stdout.stream, stderr: captureStream().stream, exit },
      );
      expect(stdout.text).toMatch(/^---\ntitle: Custom Title\n---\n/);
      expect(stdout.text).toContain("graph TB");
    });

    it("does NOT default title to the workflow name", () => {
      // Regression guard: previously we auto-filled `title` from workflow.name,
      // which broke mmdc / mermaid-live because they don't accept title frontmatter.
      const stdout = captureStream();
      runWorkflowDiagram(
        "any.yml",
        {},
        { loadWorkflowFile, stdout: stdout.stream, stderr: captureStream().stream, exit },
      );
      expect(stdout.text).not.toMatch(/title:/);
      expect(stdout.text).not.toContain("Sample"); // workflow.name
    });
  });

  describe("-o / --output file", () => {
    it("writes raw mermaid to .mmd (default)", () => {
      const out = path.join(tmpdir, "diagram.mmd");
      const stderr = captureStream();
      runWorkflowDiagram(
        "any.yml",
        { output: out },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: stderr.stream, exit },
      );
      const contents = fs.readFileSync(out, "utf8");
      expect(contents).not.toMatch(/```mermaid/);
      expect(contents).not.toMatch(/title:/);
      expect(contents).toMatch(/^graph TB/);
      expect(stderr.text).toMatch(/✓ Wrote diagram to/);
    });

    it("writes raw mermaid to .mermaid (Mermaid CLI's canonical extension)", () => {
      const out = path.join(tmpdir, "diagram.mermaid");
      runWorkflowDiagram(
        "any.yml",
        { output: out },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: captureStream().stream, exit },
      );
      const contents = fs.readFileSync(out, "utf8");
      expect(contents).not.toMatch(/```mermaid/);
      expect(contents).toMatch(/^graph TB/);
    });

    it("writes fenced markdown to .md", () => {
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

    it("writes raw mermaid for unknown extensions (no longer falls back to fenced)", () => {
      // Behavior change: previously .txt and friends got fenced as the
      // "safe default". Now raw mermaid is the safe default because that's
      // what every renderer actually accepts.
      const out = path.join(tmpdir, "diagram.txt");
      runWorkflowDiagram(
        "any.yml",
        { output: out },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: captureStream().stream, exit },
      );
      const contents = fs.readFileSync(out, "utf8");
      expect(contents).not.toMatch(/```mermaid/);
      expect(contents).toMatch(/graph TB/);
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

  describe("explicit --block / --no-block override extension inference", () => {
    it("explicit --block wins over .mmd (writes fenced to .mmd)", () => {
      const out = path.join(tmpdir, "diagram.mmd");
      runWorkflowDiagram(
        "any.yml",
        { output: out, block: true },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: captureStream().stream, exit },
      );
      expect(fs.readFileSync(out, "utf8")).toMatch(/```mermaid/);
    });

    it("explicit --no-block wins over .md (writes raw to .md)", () => {
      const out = path.join(tmpdir, "diagram.md");
      runWorkflowDiagram(
        "any.yml",
        { output: out, block: false },
        { loadWorkflowFile, stdout: captureStream().stream, stderr: captureStream().stream, exit },
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
      expect(stdout.text).toMatch(/graph TB/);
      // Confirm built-in renders raw by default too.
      expect(stdout.text).not.toMatch(/```mermaid/);
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
