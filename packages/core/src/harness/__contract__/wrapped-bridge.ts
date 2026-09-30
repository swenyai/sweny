/**
 * Wrapped + bridge contract case (#439), shared by every harness that runs its
 * agent inside the process sandbox wrapper and hands it sweny's skill tools
 * through the tool bridge (pi today, ACP next).
 *
 * The harness runs one node with sandbox mode `strict` and the host's real
 * wrapper (srt). Its fake agent, inside the sandbox, starts the bridge shim
 * from its MCP config and calls one skill tool. The case passes only when the
 * call reached the handler in this (sweny) process and came back as a
 * successful tool call.
 *
 * Runs in the `sandbox-wrapper` CI job (`vitest run src/harness/sandbox`, with
 * the core build for the shim). Skips without a wrapper, except under
 * SWENY_REQUIRE_SANDBOX_WRAPPER=1, where a missing wrapper fails.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { SandboxWrapper, SandboxWrapperDetection } from "../sandbox-wrapper.js";
import type { AgentHarness } from "../types.js";
import type { Tool } from "../../types.js";

const DIST_CLI = fileURLToPath(new URL("../../../dist/cli/main.js", import.meta.url));

export interface WrappedBridgeTarget {
  /**
   * Build the harness with `wrapper`, sandbox mode `strict` and `cwd: workspace`,
   * and script its fake agent to call the bridge tool `toolName` once with
   * `input` through its MCP client, then finish. Anything the fake writes must
   * live under `workspace` (the only writable path besides the scratch HOME).
   */
  make(opts: {
    wrapper: SandboxWrapper;
    workspace: string;
    toolName: string;
    input: Record<string, unknown>;
    /** The shipped shim (`sweny tool-bridge` from the core build), for the harness's tool bridge. */
    shim: { command: string; args: string[] };
  }): WrappedBridgeRun | Promise<WrappedBridgeRun>;
}

export interface WrappedBridgeRun {
  harness: AgentHarness;
  /** HOME the fake agent saw on its last run (from its capture): proves it ran wrapped. */
  agentHome(): string | undefined;
}

export function describeWrappedBridge(name: string, detection: SandboxWrapperDetection, target: WrappedBridgeTarget) {
  const required = process.env.SWENY_REQUIRE_SANDBOX_WRAPPER === "1";
  const wrapper = detection.wrapper;

  if (!wrapper && required) {
    describe(`${name}: wrapped + bridge (required)`, () => {
      it("a working wrapper is available on this host", () => {
        throw new Error(`SWENY_REQUIRE_SANDBOX_WRAPPER=1 but no wrapper: ${detection.reason}`);
      });
    });
  }

  describe.skipIf(!wrapper)(`${name}: wrapped agent calls a skill tool over the tool bridge`, () => {
    const dirs: string[] = [];
    afterAll(async () => {
      for (const d of dirs) await rm(d, { recursive: true, force: true });
    });

    it("the call reaches the handler in the sweny process and succeeds", { timeout: 90_000 }, async () => {
      const workspace = await mkdtemp(path.join(tmpdir(), "sweny-wrapped-bridge-"));
      dirs.push(workspace);
      const calls: unknown[] = [];
      const echo: Tool = {
        name: "echo",
        description: "Echo text back.",
        access: "read",
        input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        handler: async (input) => {
          calls.push(input);
          return { echoed: (input as { text: string }).text };
        },
      };
      const input = { text: "from-inside-the-sandbox" };
      const shim = { command: process.execPath, args: [DIST_CLI, "tool-bridge"] };
      const { harness, agentHome } = await target.make({
        wrapper: wrapper!,
        workspace,
        toolName: echo.name,
        input,
        shim,
      });
      const r = await harness.run({ instruction: "call echo", context: {}, tools: [echo] });

      expect(r.status, JSON.stringify(r.data)).toBe("success");
      expect(
        r.degraded.filter((d) => d.startsWith("sandbox")),
        "the run was wrapped, not degraded",
      ).toEqual([]);
      // The wrapper's scratch HOME (<scratch root>/sweny-<uid>/r-*/home), not the operator's.
      expect(agentHome(), "the agent ran inside the wrapper").toMatch(/[/\\]sweny-\d+[/\\]r-[^/\\]+[/\\]home$/);
      expect(calls, "the handler ran in the sweny process").toEqual([input]);
      expect(r.toolCalls).toEqual([
        { tool: "echo", input, status: "success", output: { echoed: "from-inside-the-sandbox" } },
      ]);
    });
  });
}
