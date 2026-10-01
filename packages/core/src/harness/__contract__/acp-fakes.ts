/**
 * Fake ACP agent kit for the contract suite (#416): a scripted `acp-fake.mjs`
 * process the adapter spawns through its `acpCommand` seam. The fake speaks the
 * raw Agent Client Protocol wire (schema v1.24.1), records what the adapter
 * handed it to a scratch directory, and this kit turns that into the neutral
 * {@link FakeCapture}. No fake calls a model.
 *
 * `allows(class)` comes from the fake's probe: on its first prompt the fake
 * sends one `session/request_permission` per tool class and records whether
 * the adapter selected an allow option. The fake also sends `fs/write_text_file`
 * once and records whether the adapter refused it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolClass } from "../types.js";
import type { FakeScript, FakeUsage } from "./scenarios.js";
import { bridgeSocketsIn, stillOnDisk, type FakeCapture, type HarnessFakes } from "./fakes.js";

/** What the ACP fake process recorded (harness/fakes/acp-fake.mjs). */
export interface AcpFakeCapture {
  pid: number;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  initialize: Record<string, any> | null;
  sessionCwd: string | null;
  /** The `mcpServers` array of `session/new`, verbatim. */
  mcpServers: Array<Record<string, any>>;
  mcpServersLoaded: string[];
  mcpTools?: Record<string, string[]>;
  prompts: string[];
  probe: Record<string, boolean>;
  fsWrite?: "error" | "ok";
  permissions: Array<{ id: string; outcome: { outcome: string; optionId?: string } | null }>;
  fsWrites: Array<{ path: string; error: string | null }>;
  cancels: number;
}

export interface AcpProcessFake extends HarnessFakes {
  /** Command that runs the fake in place of the agent (the adapter's `acpCommand`). */
  readonly command: { command: string; args: string[] };
  /** Every raw capture since the last reset, oldest first. */
  raw(): AcpFakeCapture[];
  /**
   * Script with the fake's own options and steps the neutral scenarios do not
   * have (`permission`, `fs-write`): see the header of fakes/acp-fake.mjs.
   */
  scriptWith(script: unknown): void;
  /** Script only the n-th spawn since the last reset (1-based). */
  scriptFor(spawn: number, script: unknown): void;
  /** Remove the fake's scratch directory (after all cases). */
  destroy(): void;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const CLASSES: ToolClass[] = ["shell", "write", "edit", "net", "subagent"];

export function createAcpProcessFake(): AcpProcessFake {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-acp-fake-"));
  const fakePath = fileURLToPath(new URL("../fakes/acp-fake.mjs", import.meta.url));
  const command = { command: process.execPath, args: [fakePath, "--fake-dir", dir] };

  const captureFiles = () =>
    fs
      .readdirSync(dir)
      .filter((f) => /^capture-\d+\.json$/.test(f))
      .sort((a, b) => parseInt(a.slice(8), 10) - parseInt(b.slice(8), 10));
  /**
   * Read one capture. The fake renames each save into place, so this should
   * parse first try; the bounded retry (50 x 10 ms, then the real error) covers
   * a file the filesystem shows mid-replace, and never waits past 0.5 s.
   */
  const readCapture = (f: string): AcpFakeCapture => {
    const wait = new Int32Array(new SharedArrayBuffer(4));
    for (let attempt = 0; ; attempt++) {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as AcpFakeCapture;
      } catch (err) {
        if (attempt >= 49) throw err;
        Atomics.wait(wait, 0, 0, 10);
      }
    }
  };
  const raw = (): AcpFakeCapture[] => captureFiles().map(readCapture);
  const writeScript = (value: unknown) => fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(value));

  const emptyCapture = (): FakeCapture => ({
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
  });

  const toCapture = (c: AcpFakeCapture, spawns: number): FakeCapture => {
    const allows = (cls: ToolClass): boolean => c.probe[cls] !== false;
    return {
      invocations: spawns,
      prompt: c.prompts.at(-1) ?? "",
      env: c.env,
      // What the adapter told the agent to load. Whether an agent also loads its own config is agent-defined
      // in ACP (mcp.exclusive is "none"), so the fake does not pretend to know.
      mcpServersLoaded: c.mcpServersLoaded,
      nativeDisallowed: [],
      allows,
      builtinToolsDisabled: CLASSES.every((k) => !allows(k)),
      sandboxed: false,
      // The adapter can always stop the process; cases 8, 9 and 14 prove it is gone.
      cancelWired: true,
      stopped: !pidAlive(c.pid),
    };
  };

  return {
    command,
    structuredChannel: false,
    // `usage_update` carries cumulative cost; `used` and `size` are context occupancy, not billed tokens.
    usageFields: ["costUsd"] as (keyof FakeUsage)[],
    reset() {
      for (const f of fs.readdirSync(dir)) {
        if (/^(capture|script)(-\d+)?\.json$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
      }
      writeScript([]);
    },
    script(steps: FakeScript) {
      writeScript(steps);
    },
    scriptWith(script) {
      writeScript(script);
    },
    scriptFor(spawn, script) {
      fs.writeFileSync(path.join(dir, `script-${spawn}.json`), JSON.stringify(script));
    },
    captured() {
      const all = raw();
      const last = all.at(-1);
      // No process ran (an abort landed before spawn): nothing is left running.
      if (!last) return emptyCapture();
      return toCapture(last, all.length);
    },
    raw,
    leftovers() {
      const paths: string[] = [];
      for (const c of raw()) {
        const byName = Object.fromEntries(c.mcpServers.map((s, i) => [`${s.name ?? i}`, s]));
        for (const s of bridgeSocketsIn(byName)) paths.push(path.dirname(s));
      }
      const live = raw()
        .filter((c) => pidAlive(c.pid))
        .map((c) => `pid ${c.pid} still running`);
      return [...stillOnDisk(paths), ...live];
    },
    dispose() {
      for (const c of raw()) {
        if (pidAlive(c.pid)) {
          try {
            process.kill(c.pid, "SIGKILL");
          } catch {
            // gone
          }
        }
      }
    },
    destroy() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
