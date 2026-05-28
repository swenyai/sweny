import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

// Mock child_process before importing the handler
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runWorkflow, resolveSwenyInvocation } from "../handlers/run-workflow.js";

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

const invocation = resolveSwenyInvocation();
const { command: cmd, prefixArgs } = invocation;

// The handler spawns `command` with `[...prefixArgs, ...cliArgs]`. Helper to
// build the expected full argv regardless of which resolution strategy hit.
const expectArgs = (...cli: string[]): string[] => [...prefixArgs, ...cli];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSwenyInvocation", () => {
  it("resolves a sweny invocation (command + prefix args)", () => {
    // Primary strategy: { command: process.execPath, prefixArgs: [<core bin>] }.
    // Fallbacks: monorepo node_modules/.bin/sweny, then bare "sweny". In every
    // case the resolved argv must point at something named "sweny".
    const joined = [invocation.command, ...invocation.prefixArgs].join(" ");
    expect(joined).toContain("sweny");
  });

  it("when core resolves, runs the resolved @sweny-ai/core bin via process.execPath", () => {
    // If @sweny-ai/core/package.json is resolvable from the test's module tree,
    // the primary strategy must be chosen: command is the current Node binary
    // and the single prefix arg points inside the installed @sweny-ai/core.
    const require = createRequire(import.meta.url);
    let corePkgPath: string | null = null;
    try {
      corePkgPath = require.resolve("@sweny-ai/core/package.json");
    } catch {
      corePkgPath = null;
    }
    if (corePkgPath) {
      expect(invocation.command).toBe(process.execPath);
      expect(invocation.prefixArgs).toHaveLength(1);
      const coreRoot = path.dirname(corePkgPath);
      expect(invocation.prefixArgs[0].startsWith(coreRoot)).toBe(true);
    } else {
      // No exported package.json (older core) → falls back to a sweny command.
      expect([invocation.command, ...invocation.prefixArgs].join(" ")).toContain("sweny");
    }
  });
});

describe("runWorkflow", () => {
  it("builds correct CLI args for triage with --stream", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    expect(mockSpawn).toHaveBeenCalledWith(
      cmd,
      expectArgs("triage", "--json", "--stream"),
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
      cmd,
      expectArgs("implement", "ABC-123", "--json", "--stream"),
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

    expect(mockSpawn).toHaveBeenCalledWith(
      cmd,
      expectArgs("triage", "--json", "--stream", "--dry-run"),
      expect.any(Object),
    );

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

  it("returns error when implement is called with whitespace-only input", async () => {
    const result = await runWorkflow({ workflow: "implement", input: "   " });

    expect(result.success).toBe(false);
    expect(result.error).toContain("implement workflow requires an issue ID");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("trims whitespace from implement input", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "implement", input: "  ABC-123  " });

    expect(mockSpawn).toHaveBeenCalledWith(
      cmd,
      expectArgs("implement", "ABC-123", "--json", "--stream"),
      expect.any(Object),
    );

    proc.stdout!.emit("data", Buffer.from('{"ok": true}\n'));
    proc._emit("close", 0);
    await promise;
  });

  it("survives a throwing onProgress callback without breaking the stream", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    let callCount = 0;
    const promise = runWorkflow({
      workflow: "triage",
      onProgress: () => {
        callCount++;
        throw new Error("callback exploded");
      },
    });

    proc.stdout!.emit(
      "data",
      Buffer.from(
        [
          '{"type":"node:enter","node":"a","instruction":"X"}',
          '{"type":"node:exit","node":"a","result":{"status":"success"}}',
          '{"a":{"status":"success"}}',
          "",
        ].join("\n"),
      ),
    );
    proc._emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
    // Both events with type field attempted delivery
    expect(callCount).toBe(2);
    // Final result is still captured despite callback failures
    expect(JSON.parse(result.output)).toEqual({ a: { status: "success" } });
  });

  it("processes remaining lineBuf data on close (no trailing newline)", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    // Send data without trailing newline — it stays in lineBuf until close
    proc.stdout!.emit("data", Buffer.from('{"final":"result"}'));
    proc._emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({ final: "result" });
  });

  it("includes partial output in timed-out result", async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "triage" });

    // Some progress arrives before timeout
    proc.stdout!.emit("data", Buffer.from('{"type":"node:enter","node":"a","instruction":"X"}\n'));
    proc.stdout!.emit("data", Buffer.from('{"partial":"data"}\n'));

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    proc._emit("close", null);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe("Workflow timed out after 10 minutes");
    // Last JSON line before timeout is preserved
    expect(JSON.parse(result.output)).toEqual({ partial: "data" });

    vi.useRealTimers();
  });
});

describe("runWorkflow custom workflows (file-run path)", () => {
  const tempDirs: string[] = [];

  function freshProject(): string {
    const dir = path.join(tmpdir(), `sweny-mcp-run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const workflowDir = path.join(dir, ".sweny", "workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowDir, "custom.yml"),
      [
        "id: my-custom",
        "name: My Custom Workflow",
        "description: A test custom workflow",
        "entry: start",
        "nodes:",
        "  start:",
        "    name: Start",
        "    instruction: Do the thing",
        "    skills: []",
        "edges: []",
      ].join("\n"),
    );
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  // The custom path resolves the workflow file with several chained `await`s
  // backed by real libuv fs I/O (readdir → readFile → parse) before spawning,
  // so wait until spawn is actually called before driving the child's events.
  //
  // Poll on a macrotask (setTimeout, which yields through the libuv poll phase
  // where fs callbacks land) with a wall-clock deadline rather than a fixed
  // tick count. A fixed `setImmediate` cap can undershoot on a slow/loaded CI
  // runner when the fs chain has not completed in N ticks, which surfaced as a
  // flaky "Number of calls: 0" failure on the Node 20 job.
  async function waitForSpawn(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (mockSpawn.mock.calls.length === 0) {
      if (Date.now() > deadline) {
        throw new Error("timed out waiting for sweny CLI spawn");
      }
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  it("dispatches a custom workflow id via `workflow run <file>`", async () => {
    const dir = freshProject();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "my-custom", cwd: dir });
    await waitForSpawn();

    const expectedFile = path.join(dir, ".sweny", "workflows", "custom.yml");
    expect(mockSpawn).toHaveBeenCalledWith(
      cmd,
      expectArgs("workflow", "run", expectedFile, "--json", "--stream"),
      expect.objectContaining({ cwd: dir, stdio: ["ignore", "pipe", "pipe"] }),
    );

    proc.stdout!.emit("data", Buffer.from('{"ok": true}\n'));
    proc._emit("close", 0);
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("passes optional input through as --input for a custom workflow", async () => {
    const dir = freshProject();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runWorkflow({ workflow: "my-custom", cwd: dir, input: '{"foo":"bar"}', dryRun: true });
    await waitForSpawn();

    const expectedFile = path.join(dir, ".sweny", "workflows", "custom.yml");
    expect(mockSpawn).toHaveBeenCalledWith(
      cmd,
      expectArgs("workflow", "run", expectedFile, "--input", '{"foo":"bar"}', "--json", "--stream", "--dry-run"),
      expect.any(Object),
    );

    proc._emit("close", 0);
    await promise;
  });

  it("returns an error (no spawn) for an unknown custom workflow id", async () => {
    const dir = freshProject();

    const result = await runWorkflow({ workflow: "does-not-exist", cwd: dir });

    expect(result.success).toBe(false);
    expect(result.error).toContain("was not found in .sweny/workflows/");
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
