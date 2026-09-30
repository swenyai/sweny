import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecuteOptions } from "../../executor.js";
import type { NodeResult, Workflow } from "../../types.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), spawn: vi.fn() }));
vi.mock("../../executor.js", () => ({ execute: mocks.execute }));
vi.mock("../../harness/index.js", () => ({
  createHarness: () => ({ preflight: async () => ({ ok: true, version: "test" }) }),
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}));
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  validateInputs: () => [],
}));
vi.mock("../config-file.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config-file.js")>()),
  loadDotenv: () => {},
  loadConfigFile: () => ({}),
  applyAgentFileConfig: () => {},
}));
vi.mock("../../skills/custom-loader.js", () => ({
  configuredSkills: () => [],
  configuredSkillsWithDiagnostics: () => ({ skills: [], warnings: [] }),
}));
vi.mock("../cloud-lifecycle.js", () => ({
  beginCloudLifecycle: async () => null,
  finishCloudLifecycle: async () => {},
  createCloudStreamObserver: () => undefined,
}));
vi.mock("../cloud-report.js", () => ({ reportToCloud: async () => {} }));
vi.mock("../../templates.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../templates.js")>()),
  loadAdditionalContext: async () => ({ resolved: "" }),
}));
vi.mock("../version-check.js", () => ({
  maybeNudge: async () => {},
  defaultCachePath: () => "unused",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("implement CLI to MCP output contract", () => {
  it.each(["success", "failed"] as const)("returns the actual %s CLI result through MCP", async (status) => {
    vi.resetModules();
    mocks.execute.mockClear();
    const results = new Map<string, NodeResult>([
      ["analyze", { status, data: { summary: "A multiline result\nwith café and {braces}" }, toolCalls: [] }],
    ]);
    // No agent or external service runs. The real command action, stream
    // observer, JSON formatter and MCP parser remain in the contract.
    mocks.execute.mockImplementation(async (_workflow: Workflow, _input: unknown, options: ExecuteOptions) => {
      options.observer?.({ type: "node:enter", node: "analyze", instruction: "Analyze" });
      options.observer?.({ type: "node:exit", node: "analyze", result: results.get("analyze")! });
      return { results };
    });

    const child = new EventEmitter() as ChildProcess;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn().mockReturnValue(true);
    mocks.spawn.mockReturnValue(child);

    // Dynamic cross-package import avoids pulling MCP source into core's
    // declaration build while exercising its actual consumer implementation.
    const mcpHandler = fileURLToPath(new URL("../../../../mcp/src/handlers/run-workflow.ts", import.meta.url));
    const { runWorkflow } = await import(mcpHandler);
    const onProgress = vi.fn();
    const resultPromise = runWorkflow({ workflow: "implement", input: "TEST-1", onProgress });

    vi.spyOn(console, "log").mockImplementation((message: unknown) => {
      child.stdout!.emit("data", Buffer.from(String(message) + "\n"));
    });
    let cliStderr = "";
    vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      cliStderr += String(message) + "\n";
    });
    let flushTerminal: (() => void) | undefined;
    vi.spyOn(process.stdout, "write").mockImplementation(
      (
        chunk: string | Uint8Array,
        encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
        callback?: (error?: Error | null) => void,
      ) => {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
        const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
        if (done) {
          // Simulate a pipe under backpressure: terminal bytes are not delivered
          // until the test releases the write. The command must not exit early.
          flushTerminal = () => {
            child.stdout!.emit("data", bytes);
            done();
          };
          return false;
        }
        child.stdout!.emit("data", bytes);
        return true;
      },
    );
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      cliStderr += String(chunk);
      return true;
    });
    const stopped = new Error("CLI process exited");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw stopped;
    });
    const originalArgv = process.argv;
    process.argv = [process.execPath, "sweny", "implement", "TEST-1", "--json", "--stream"];
    try {
      const command = import("../main.js");
      const commandFinished = expect(command).rejects.toBe(stopped);
      await vi.waitFor(() => expect(flushTerminal, cliStderr).toBeDefined());
      expect(exit).not.toHaveBeenCalled();
      flushTerminal!();
      await commandFinished;
    } finally {
      process.argv = originalArgv;
      child.emit("close", status === "success" ? 0 : 1);
    }
    const result = await resultPromise;
    expect(mocks.execute, cliStderr).toHaveBeenCalledOnce();
    expect(exit.mock.calls[0][0]).toBe(status === "success" ? 0 : 1);
    expect(result.success).toBe(status === "success");
    expect(JSON.parse(result.output)).toEqual(Object.fromEntries(results));
    expect(onProgress).toHaveBeenCalledTimes(2);
  });
});
