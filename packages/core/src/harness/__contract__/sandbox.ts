/**
 * Contract case 15 (#360 step 2): a harness without a native sandbox runs its
 * agent process only through the process wrapper, and strict sandbox mode
 * refuses the node when no wrapper is available.
 *
 * The {@link createRecordingWrapper} stands in for srt: it records every wrap
 * request and marks the wrapped env, so the fake agent's captured env proves
 * the process was started from the wrapped spawn and not the original one.
 * The real srt containment is proven separately on Linux CI
 * (harness/sandbox/contained.test.ts).
 */

import { expect, vi } from "vitest";
import type { Logger } from "../../types.js";
import type { SandboxWrapper, SandboxWrapRequest, WrappedSpawn } from "../sandbox-wrapper.js";
import type { AgentHarness, HarnessRunRequest, NodePolicy } from "../types.js";
import type { HarnessFakes } from "./fakes.js";
import type { FakeScript } from "./scenarios.js";

/** Env var the recording wrapper sets on the wrapped spawn. */
export const WRAPPED_MARK = "SWENY_TEST_SANDBOX_WRAPPED";

export interface RecordingWrapper extends SandboxWrapper {
  readonly id: string;
  readonly requests: SandboxWrapRequest[];
  /** Cleanups called so far. */
  cleanups: number;
}

let seq = 0;

/** A wrapper that records what it was asked to contain and runs the command as is. */
export function createRecordingWrapper(): RecordingWrapper {
  const id = `rec-${process.pid}-${++seq}`;
  const w: RecordingWrapper = {
    backend: "srt",
    provides: { sandbox: true, egress: true, readOnlyMount: true, readDeny: true },
    id,
    requests: [],
    cleanups: 0,
    async wrap(req: SandboxWrapRequest): Promise<WrappedSpawn> {
      w.requests.push({ ...req, egress: [...req.egress], env: { ...req.env } });
      let done = false;
      return {
        command: req.command,
        args: [...req.args],
        cwd: req.cwd,
        env: { ...req.env, [WRAPPED_MARK]: id },
        home: req.cwd,
        async cleanup() {
          if (done) return;
          done = true;
          w.cleanups++;
        },
      };
    },
  };
  return w;
}

type Skip = (note?: string) => void;

/** Builds the adapter under test. `sandboxWrapper: null` means "no wrapper on this host". */
export type MakeWithWrapper = (opts: {
  logger: Logger;
  sandboxWrapper?: SandboxWrapper | null;
}) => AgentHarness | Promise<AgentHarness>;

const DONE: FakeScript = [{ kind: "final", text: "done" }];
const NODE_HOST = "node-host.example.test";

function mkLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function policy(sandbox: "auto" | "strict", readOnly = false): NodePolicy {
  return { readOnly, deny: [], egress: [NODE_HOST], strict: false, sandbox };
}

function req(over: Partial<HarnessRunRequest> = {}): HarnessRunRequest {
  return { instruction: "Do the thing.", context: {}, tools: [], ...over };
}

export async function sandboxWrapperCase(make: MakeWithWrapper, fakes: HarnessFakes, skip: Skip): Promise<void> {
  await fakes.reset();
  const probe = await make({ logger: mkLogger(), sandboxWrapper: null });
  if (probe.capabilities.sandbox.fs && probe.capabilities.sandbox.network) {
    return skip("sandbox is native (fs and network)");
  }

  // 1. A wrapper is available: the agent process starts only from the wrapped spawn.
  const rec = createRecordingWrapper();
  await fakes.reset();
  const h = await make({ logger: mkLogger(), sandboxWrapper: rec });
  fakes.script(DONE);
  const r = await h.run(req({ policy: policy("strict") }));
  expect(r.status, "wrapped run").toBe("success");
  expect(rec.requests.length, "wrap requests").toBeGreaterThan(0);
  for (const q of rec.requests) expect(q.egress, "node egress reaches the wrapper").toContain(NODE_HOST);
  expect(fakes.captured().env[WRAPPED_MARK], "agent started from the wrapped spawn").toBe(rec.id);
  expect(
    r.degraded.filter((d) => /sandbox|egress/.test(d)),
    "wrapper covers sandbox and egress",
  ).toEqual([]);
  expect(rec.cleanups, "every wrap is cleaned up").toBe(rec.requests.length);

  // 2. Dry run through the wrapper: read-only reaches it.
  fakes.script(DONE);
  await h.run(req({ readOnly: true, policy: policy("strict", true) }));
  expect(rec.requests.at(-1)?.readOnly, "read-only reaches the wrapper").toBe(true);

  // 3. No wrapper, strict: refused before the agent starts.
  await fakes.reset();
  const bare = await make({ logger: mkLogger(), sandboxWrapper: null });
  fakes.script(DONE);
  const refused = await bare.run(req({ policy: policy("strict") }));
  expect(refused.status, "strict without a wrapper").toBe("failed");
  expect(String(refused.data.error)).toMatch(/sandbox/i);
  expect(fakes.captured().invocations, "agent never started").toBe(0);

  // 4. No wrapper, auto: runs unwrapped and says so.
  fakes.script(DONE);
  const warned = await bare.run(req({ policy: policy("auto") }));
  expect(warned.status, "auto without a wrapper").toBe("success");
  expect(
    warned.degraded.some((d) => /sandbox/.test(d)),
    "degraded names the sandbox",
  ).toBe(true);
  expect(fakes.captured().env[WRAPPED_MARK]).toBeUndefined();
}
