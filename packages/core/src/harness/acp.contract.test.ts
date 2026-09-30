import { afterAll, vi } from "vitest";
import { runContractSuite } from "./__contract__/suite.js";
import { createAcpProcessFake } from "./__contract__/acp-fakes.js";
import { AcpHarness } from "./acp.js";

// AcpHarness over a scripted fake ACP agent (#416). The fake speaks the raw
// Agent Client Protocol wire (schema v1.24.1) over stdio and answers the way an
// agent would; it records what the adapter handed it. No model is called.
// Each case spawns real (fake) processes, several per case; give a loaded CI runner room.
vi.setConfig({ testTimeout: 60_000 });

const fakes = createAcpProcessFake();
afterAll(() => fakes.destroy());

// ACP declares no native sandbox, exclusive MCP, deny list or read-only mode, so the suite
// skips cases 2 and 17 (mcp exclusive is "none") and checks the gate for cases 3, 4, 16 and 18;
// case 15 proves the agent only ever runs inside the wrapper.
runContractSuite(
  ({ logger, sandboxWrapper }) =>
    new AcpHarness({
      logger,
      envScope: true,
      policy: "warn",
      acpCommand: fakes.command,
      killGraceMs: 500,
      cancelGraceMs: 1000,
      // No host srt probe in tests: case 15 hands in its recording wrapper, every other case has none.
      sandboxWrapper: sandboxWrapper ?? null,
      sandbox: "off",
    }),
  fakes,
  "acp",
);
