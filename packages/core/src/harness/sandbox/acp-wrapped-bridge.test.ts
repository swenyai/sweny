/**
 * ACP, wrapped + bridge (#439): the ACP adapter runs its (fake) agent under the
 * host's real srt wrapper, and the agent's MCP client inside the sandbox calls
 * a sweny skill tool through the tool bridge shim, tunnelled to the bridge's
 * loopback port through srt's proxy. Runs in the `sandbox-wrapper` CI job; see
 * __contract__/wrapped-bridge.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describeWrappedBridge } from "../__contract__/wrapped-bridge.js";
import { AcpHarness } from "../acp.js";
import { detectSandboxWrapper } from "../sandbox-wrapper.js";

const ACP_FAKE = fileURLToPath(new URL("../fakes/acp-fake.mjs", import.meta.url));
const silent = { info() {}, warn() {}, error() {}, debug() {} };

describeWrappedBridge("acp", await detectSandboxWrapper(), {
  make({ wrapper, workspace, toolName, input, shim }) {
    // The fake records its capture and reads its script here; inside the
    // sandbox only the workspace and the scratch HOME are writable.
    const fakeDir = path.join(workspace, ".acp-fake");
    fs.mkdirSync(fakeDir, { recursive: true });
    fs.writeFileSync(
      path.join(fakeDir, "script.json"),
      JSON.stringify({
        callMcp: true,
        steps: [
          { kind: "tool-call", id: "t1", name: toolName, input },
          { kind: "final", text: "done" },
        ],
      }),
    );
    const harness = new AcpHarness({
      logger: silent,
      envScope: true,
      policy: "warn",
      acpCommand: { command: process.execPath, args: [ACP_FAKE, "--fake-dir", fakeDir] },
      cwd: workspace,
      sandbox: "strict",
      sandboxWrapper: wrapper,
      toolBridgeShim: shim,
      killGraceMs: 2000,
      cancelGraceMs: 2000,
    });
    const agentHome = () => {
      const captures = fs.readdirSync(fakeDir).filter((f) => /^capture-\d+\.json$/.test(f));
      if (captures.length === 0) return undefined;
      const last = captures.sort((a, b) => parseInt(a.slice(8), 10) - parseInt(b.slice(8), 10)).at(-1)!;
      return JSON.parse(fs.readFileSync(path.join(fakeDir, last), "utf8")).env?.HOME as string | undefined;
    };
    return { harness, agentHome };
  },
});
