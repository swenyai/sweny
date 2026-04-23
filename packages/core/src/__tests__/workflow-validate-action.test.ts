import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Round 3 (PR review): the loader is unit-tested but the CLI surface
// (`sweny workflow validate <file>`) wasn't exercised end-to-end. These
// tests spawn the built CLI and assert on real exit codes + stdout shape,
// closing the loop on the contract IDE / CI tooling depend on.
//
// The CLI is invoked via `node dist/cli/main.js`; test is skipped if the
// build hasn't run yet.

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = resolve(__dirname, "..", "..", "dist", "cli", "main.js");
const HAS_BUILD = existsSync(CLI_BIN);

function makeTempFile(name: string, content: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sweny-validate-action-test-"));
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runValidate(file: string, jsonMode = false): CliResult {
  const args = ["workflow", "validate", file];
  if (jsonMode) args.push("--json");
  const r = spawnSync("node", [CLI_BIN, ...args], { encoding: "utf-8" });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe.runIf(HAS_BUILD)("`sweny workflow validate` (CLI surface)", () => {
  it("exits 0 and prints success on a valid workflow", () => {
    const f = makeTempFile(
      "good.yml",
      `id: demo
name: Demo
description: d
entry: a
nodes:
  a:
    name: A
    instruction: do a
    skills: []
edges: []
`,
    );
    try {
      const r = runValidate(f.path, false);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/is valid/);
    } finally {
      f.cleanup();
    }
  });

  it("exits 1 and reports a structured error on a malformed workflow", () => {
    // Missing entry — Zod-level rejection.
    const f = makeTempFile(
      "bad.yml",
      `id: x
name: X
nodes:
  a: { name: A, instruction: x, skills: [] }
edges: []
`,
    );
    try {
      const r = runValidate(f.path, false);
      expect(r.status).toBe(1);
      // The schema error must mention 'entry' since that's the missing field.
      expect(r.stderr).toMatch(/entry/i);
    } finally {
      f.cleanup();
    }
  });

  it("exits 1 with a single JSON object on stdout when --json is set", () => {
    const f = makeTempFile("bad.yml", `id: x\nname: X\nnodes: "not an object"\nentry: a\nedges: []\n`);
    try {
      const r = runValidate(f.path, true);
      expect(r.status).toBe(1);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.valid).toBe(false);
      expect(Array.isArray(parsed.errors)).toBe(true);
      expect(parsed.errors.length).toBeGreaterThan(0);
    } finally {
      f.cleanup();
    }
  });

  it("exits 0 with valid:true JSON on a good workflow when --json is set", () => {
    const f = makeTempFile(
      "good.yml",
      `id: demo
name: Demo
entry: a
nodes:
  a:
    name: A
    instruction: do a
    skills: []
edges: []
`,
    );
    try {
      const r = runValidate(f.path, true);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed).toEqual({ valid: true, errors: [] });
    } finally {
      f.cleanup();
    }
  });

  it("exits 1 on a non-existent file with an IO-level error message", () => {
    const r = runValidate("/nonexistent/does-not-exist.yml", true);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e: { message: string }) => /read|ENOENT/i.test(e.message))).toBe(true);
  });
});
