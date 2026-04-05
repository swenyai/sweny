import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

// Mock child_process before importing the handler
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { runWorkflow } from "../handlers/run-workflow.js";

const mockSpawn = vi.mocked(spawn);

function createMockProcess(): ChildProcess & { _emit: (event: string, ...args: unknown[]) => void } {
  const proc = new EventEmitter() as ChildProcess & { _emit: (event: string, ...args: unknown[]) => void };
  proc.stdout = new Readable({ read() {} }) as ChildProcess["stdout"];
  proc.stderr = new Readable({ read() {} }) as ChildProcess["stderr"];
  proc.kill = vi.fn().mockReturnValue(true);
  proc._emit = (event: string, ...args: unknown[]) => {
    proc.emit(event, ...args);
  };
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runWorkflow", () => {
  it("builds correct CLI args for triage", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    expect(mockSpawn).toHaveBeenCalledWith("npx", ["sweny", "triage", "--json"], expect.any(Object));

    proc.stdout!.emit("data", Buffer.from('{"ok": true}'));
    proc._emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("builds correct CLI args for implement with issue ID", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "implement", input: "ABC-123" });

    expect(mockSpawn).toHaveBeenCalledWith("npx", ["sweny", "implement", "ABC-123", "--json"], expect.any(Object));

    proc.stdout!.emit("data", Buffer.from('{"ok": true}'));
    proc._emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("adds --dry-run flag when requested", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage", dryRun: true });

    expect(mockSpawn).toHaveBeenCalledWith("npx", ["sweny", "triage", "--json", "--dry-run"], expect.any(Object));

    proc._emit("close", 0);
    await promise;
  });

  it("parses JSON output on success", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    const output = JSON.stringify({ prepare: { status: "success" } });
    proc.stdout!.emit("data", Buffer.from(output));
    proc._emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.output).toBe(output);
  });

  it("returns error on non-zero exit with stderr", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    proc.stderr!.emit("data", Buffer.from("Missing .sweny.yml config"));
    proc._emit("close", 1);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe("Missing .sweny.yml config");
  });

  it("returns error with exit code when stderr is empty", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });
    proc._emit("close", 1);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe("Process exited with code 1");
  });

  it("handles spawn error", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });
    proc._emit("error", new Error("ENOENT"));

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to spawn sweny");
    expect(result.error).toContain("ENOENT");
  });
});
