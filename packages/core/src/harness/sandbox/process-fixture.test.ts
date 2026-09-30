/**
 * Contract case 15 against a real process adapter (#360 step 2).
 *
 * Claude Code sandboxes natively, so case 15 skips for it. This fixture is the
 * shape pi and ACP adapters take: no native sandbox, one spawned agent
 * process, `prepareAgentSpawn` before the spawn. It spawns the fake agent
 * (fake-agent.mjs), which appends its env to a capture file, so the case can
 * see whether the process was started from the wrapped spawn. Runs anywhere:
 * the wrapper here is the recording one, not srt (contained.test.ts covers srt).
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, it } from "vitest";
import { buildAgentEnv } from "../../agent-env.js";
import type { FakeCapture, HarnessFakes } from "../__contract__/fakes.js";
import { sandboxWrapperCase } from "../__contract__/sandbox.js";
import { prepareAgentSpawn, type SandboxWrapper } from "../sandbox-wrapper.js";
import type { AgentHarness, HarnessCapabilities, HarnessRunRequest, HarnessRunResult, NodePolicy } from "../types.js";

const FAKE_AGENT = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));

/** Weak, like pi and ACP-generic: nothing native but env scoping. */
const PROCESS_CAPS: HarnessCapabilities = {
  structuredOutput: "prompt",
  toolTrace: "skill-only",
  builtinDeny: "none",
  mcp: { inject: true, exclusive: "none" },
  sandbox: { fs: false, network: false },
  readOnly: "none",
  turnLimit: "watchdog",
  usage: { tokens: false, costUsd: false, live: false },
  cancel: "kill",
  resume: false,
};

class ProcessFixtureHarness implements AgentHarness {
  readonly id = "acp:fixture" as const;
  readonly capabilities = PROCESS_CAPS;

  constructor(
    private readonly wrapper: SandboxWrapper | null,
    private readonly capturePath: string,
  ) {}

  async preflight(): Promise<{ ok: true; version: string }> {
    return { ok: true, version: "0.0.0" };
  }

  async complete(): Promise<string | null> {
    return null;
  }

  async run(req: HarnessRunRequest): Promise<HarnessRunResult> {
    const harness = { id: this.id, version: "0.0.0" };
    const policy: NodePolicy = req.policy ?? {
      readOnly: !!req.readOnly,
      deny: [],
      egress: req.agentAccess?.domains ?? [],
      strict: false,
    };
    const prep = await prepareAgentSpawn({
      caps: this.capabilities,
      policy,
      wrapper: this.wrapper,
      env: {},
      spawn: {
        command: process.execPath,
        args: [FAKE_AGENT, JSON.stringify([{ kind: "dumpEnv", path: this.capturePath }])],
        env: buildAgentEnv(process.env),
        cwd: process.cwd(),
      },
    });
    if (prep.refuse) {
      return { status: "failed", data: { error: prep.refuse }, toolCalls: [], harness, degraded: prep.degraded };
    }
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(prep.spawn.command, prep.spawn.args, {
          cwd: prep.spawn.cwd,
          env: prep.spawn.env,
          stdio: ["ignore", "ignore", "inherit"],
        });
        child.on("error", reject);
        child.on("exit", resolve);
      });
      if (code !== 0) {
        return {
          status: "failed",
          data: { error: `agent exited ${code}` },
          toolCalls: [],
          harness,
          degraded: prep.degraded,
        };
      }
      return { status: "success", data: { summary: "done" }, toolCalls: [], harness, degraded: prep.degraded };
    } finally {
      await prep.cleanup();
    }
  }
}

const dir = await mkdtemp(path.join(tmpdir(), "sweny-process-fixture-"));
const capturePath = path.join(dir, "capture.jsonl");

/** Fakes over the capture file: one JSON line per agent start. Scripts are ignored (the fixture always finishes). */
const fakes: HarnessFakes = {
  async reset() {
    await writeFile(capturePath, "");
  },
  script() {},
  captured(): FakeCapture {
    // Read synchronously through the last snapshot taken by `snapshot()`.
    return snapshot;
  },
  leftovers: () => [],
  dispose() {},
};

let snapshot: FakeCapture = emptyCapture();

function emptyCapture(): FakeCapture {
  return {
    invocations: 0,
    prompt: "",
    env: {},
    mcpServersLoaded: [],
    nativeDisallowed: [],
    allows: () => true,
    builtinToolsDisabled: false,
    sandboxed: false,
    cancelWired: true,
    stopped: true,
  };
}

async function refresh(): Promise<void> {
  const lines = (await readFile(capturePath, "utf8")).split("\n").filter(Boolean);
  const last = lines.length > 0 ? (JSON.parse(lines[lines.length - 1]) as { env: Record<string, string> }) : undefined;
  snapshot = { ...emptyCapture(), invocations: lines.length, env: last?.env ?? {} };
}

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("harness contract: process fixture (no native sandbox)", () => {
  it("15 sandbox wrapper: no native sandbox means the agent runs only inside the wrapper, and strict refuses without one", async (ctx) => {
    await sandboxWrapperCase(
      ({ sandboxWrapper }) => {
        const h = new ProcessFixtureHarness(sandboxWrapper ?? null, capturePath);
        // Refresh the capture after every run so `fakes.captured()` reflects it.
        return {
          id: h.id,
          capabilities: h.capabilities,
          preflight: () => h.preflight(),
          complete: () => h.complete(),
          run: async (req) => {
            try {
              return await h.run(req);
            } finally {
              await refresh();
            }
          },
        };
      },
      {
        ...fakes,
        async reset() {
          await fakes.reset();
          snapshot = emptyCapture();
        },
      },
      () => ctx.skip(),
    );
  });
});
