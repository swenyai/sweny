import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

// Mock child_process before importing the handler
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { runWorkflow, resolveSwenyBin } from "../handlers/run-workflow.js";

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

const bin = resolveSwenyBin();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSwenyBin", () => {
  it("returns an absolute path ending in sweny", () => {
    expect(bin).toMatch(/\/node_modules\/\.bin\/sweny$/);
    expect(bin).toMatch(/^\//); // absolute
  });
});

describe("runWorkflow", () => {
  it("builds correct CLI args for triage with --stream", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    expect(mockSpawn).toHaveBeenCalledWith(
      bin,
      ["triage", "--json", "--stream"],
      expect.objectContaining({ cwd: expect.any(String), stdio: ["ignore", "pipe", "pipe"] }),
    );

    proc.stdout!.emit("data", Buffer.from('{"ok": true}\n'));
    proc._emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("builds correct CLI args for implement with issue ID", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "implement", input: "ABC-123" });

    expect(mockSpawn).toHaveBeenCalledWith(
      bin,
      ["implement", "ABC-123", "--json", "--stream"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );

    proc.stdout!.emit("data", Buffer.from('{"ok": true}\n'));
    proc._emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("adds --dry-run flag when requested", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage", dryRun: true });

    expect(mockSpawn).toHaveBeenCalledWith(bin, ["triage", "--json", "--stream", "--dry-run"], expect.any(Object));

    proc._emit("close", 0);
    await promise;
  });

  it("parses final JSON result from NDJSON stream", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    // Simulate NDJSON stream: events then final result
    proc.stdout!.emit(
      "data",
      Buffer.from(
        [
          '{"type":"workflow:start","workflow":"triage"}',
          '{"type":"node:enter","node":"prepare","instruction":"Gather data"}',
          '{"type":"node:exit","node":"prepare","result":{"status":"success","data":{},"toolCalls":[]}}',
          '{"prepare":{"status":"success","data":{},"toolCalls":[]}}',
          "",
        ].join("\n"),
      ),
    );
    proc._emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
    // The last valid JSON line is the final result
    expect(JSON.parse(result.output)).toEqual({
      prepare: { status: "success", data: {}, toolCalls: [] },
    });
  });

  it("calls onProgress for stream events", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const events: Record<string, unknown>[] = [];
    const promise = runWorkflow({
      workflow: "triage",
      onProgress: (e) => events.push(e),
    });

    proc.stdout!.emit(
      "data",
      Buffer.from(
        [
          '{"type":"node:enter","node":"prepare","instruction":"Go"}',
          '{"type":"node:progress","node":"prepare","message":"Querying logs..."}',
          '{"type":"node:exit","node":"prepare","result":{"status":"success","data":{},"toolCalls":[]}}',
          '{"prepare":{"status":"success"}}',
          "",
        ].join("\n"),
      ),
    );
    proc._emit("close", 0);

    await promise;
    expect(events).toHaveLength(3); // 3 events with type field (last line has no type)
    expect(events[0]).toEqual({ type: "node:enter", node: "prepare", instruction: "Go" });
    expect(events[1]).toEqual({ type: "node:progress", node: "prepare", message: "Querying logs..." });
    expect(events[2]).toMatchObject({ type: "node:exit", node: "prepare" });
  });

  it("handles chunked NDJSON across multiple data events", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const events: Record<string, unknown>[] = [];
    const promise = runWorkflow({
      workflow: "triage",
      onProgress: (e) => events.push(e),
    });

    // Simulate data arriving in chunks that split across line boundaries
    proc.stdout!.emit("data", Buffer.from('{"type":"node:ent'));
    proc.stdout!.emit("data", Buffer.from('er","node":"a","instruction":"X"}\n{"result":'));
    proc.stdout!.emit("data", Buffer.from('"ok"}\n'));
    proc._emit("close", 0);

    await promise;
    expect(events).toHaveLength(1); // only the event with type field
    expect(events[0]).toEqual({ type: "node:enter", node: "a", instruction: "X" });
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

  it("handles spawn error followed by close (realistic ENOENT sequence)", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    proc._emit("error", new Error("ENOENT"));
    proc._emit("close", null);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to spawn sweny CLI");
    expect(result.error).toContain("ENOENT");
  });

  it("returns error when implement is called without input", async () => {
    const result = await runWorkflow({ workflow: "implement" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("implement workflow requires an issue ID");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("returns error when implement is called with empty string input", async () => {
    const result = await runWorkflow({ workflow: "implement", input: "" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("implement workflow requires an issue ID");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("handles null exit code from signal kill", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });
    proc._emit("close", null);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("killed by signal");
  });

  it("reports timeout when process is killed", async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

    proc._emit("close", null);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe("Workflow timed out after 10 minutes");

    vi.useRealTimers();
  });
});
