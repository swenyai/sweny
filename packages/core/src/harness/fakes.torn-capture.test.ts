import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCodexProcessFake, createPiProcessFake } from "./__contract__/fakes.js";
import { CodexHarness } from "./codex.js";
import { PiHarness } from "./pi.js";
import type { AgentHarness } from "./types.js";
import type { Logger } from "../types.js";

// The codex and pi fakes record each invocation to `capture-<n>.json`, and the
// contract kit parses those files after the run. Contract case 09 aborts the
// run 50 ms in, so the SIGTERM can land while the fake is inside a capture
// save: the file is opened (truncated) and nothing is written yet. These cases
// pin that interleaving: the preload holds the fake at exactly that point, and
// the caller aborts only once the fake says it is held. The kit must still read
// a consistent capture, never a torn one (release run 42303823538).
vi.setConfig({ testTimeout: 60_000 });

const preload = pathToFileURL(fileURLToPath(new URL("./fakes/hold-capture-save.mjs", import.meta.url))).href;

const fakeDir = (command: { args: string[] }) => command.args[command.args.indexOf("--fake-dir") + 1];

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A logger that aborts the run as soon as the fake reports it is held mid-save. */
function abortWhenHeld(ac: AbortController): { logger: Logger; heldPid: () => number | undefined } {
  let pid: number | undefined;
  const debug = (msg: string) => {
    const m = /hold-capture-save: holding pid (\d+)/.exec(msg);
    if (m && pid === undefined) {
      pid = Number(m[1]);
      ac.abort();
    }
  };
  return { logger: { info: () => {}, warn: () => {}, error: () => {}, debug }, heldPid: () => pid };
}

const codex = createCodexProcessFake();
const pi = createPiProcessFake();
afterAll(() => {
  codex.destroy();
  pi.destroy();
});

const lanes = [
  {
    label: "codex",
    fakes: codex,
    // Save 1 is the only save without MCP: the capture file is created by it.
    saves: [1],
    make: (logger: Logger): AgentHarness =>
      new CodexHarness({
        logger,
        envScope: true,
        policy: "warn",
        codexCommand: { command: codex.command.command, args: ["--import", preload, ...codex.command.args] },
        killGraceMs: 500,
        authProbe: () => ({ ok: true, via: "test" }),
        sandboxWrapper: null,
        sandbox: "off",
      }),
  },
  {
    label: "pi",
    fakes: pi,
    // Save 1 creates the capture file; save 2 rewrites it when the prompt arrives.
    saves: [1, 2],
    make: (logger: Logger): AgentHarness =>
      new PiHarness({
        logger,
        envScope: true,
        policy: "warn",
        piCommand: { command: pi.command.command, args: ["--import", preload, ...pi.command.args] },
        cwd: pi.projectDir,
        abortGraceMs: 500,
        killGraceMs: 500,
        sandboxWrapper: null,
        sandbox: "off",
      }),
  },
];

for (const lane of lanes) {
  describe(`${lane.label} fake: an abort inside a capture save never leaves a torn capture`, () => {
    const armFile = path.join(fakeDir(lane.fakes.command), "hold-save");
    afterEach(async () => {
      fs.rmSync(armFile, { force: true });
      vi.unstubAllEnvs();
      await lane.fakes.dispose();
    });

    for (const save of lane.saves) {
      it(`abort held in save ${save}`, async () => {
        await lane.fakes.reset();
        lane.fakes.script([{ kind: "hang" }]);
        fs.writeFileSync(armFile, String(save));
        const ac = new AbortController();
        const { logger, heldPid } = abortWhenHeld(ac);

        const r = await lane
          .make(logger)
          .run({ instruction: "Do the thing.", context: {}, tools: [], signal: ac.signal });

        // The abort landed while the fake was held inside the save, and it stopped the fake.
        const pid = heldPid();
        expect(pid).toBeTypeOf("number");
        expect(r.status).toBe("failed");
        expect(pidAlive(pid!)).toBe(false);
        // The kit reads what the fake left behind without a parse error.
        expect(() => lane.fakes.raw()).not.toThrow();
        expect(lane.fakes.captured().stopped).toBe(true);
        expect(lane.fakes.leftovers()).toEqual([]);
      });
    }
  });
}
