import { afterAll, vi } from "vitest";
import { runContractSuite } from "./__contract__/suite.js";
import { createPiProcessFake } from "./__contract__/fakes.js";
import { PI_AUTH_VARS } from "../agent-env.js";
import { PiHarness } from "./pi.js";

// PiHarness over a scripted fake `pi --mode rpc` process (#415). The fake parses
// the argv, env and stdin the adapter hands it the way pi does and answers in
// pi's RPC and event schema. No model is called.
// Each case spawns real (fake) processes, several per case; give a loaded CI runner room.
vi.setConfig({ testTimeout: 60_000 });

const fakes = createPiProcessFake();
afterAll(() => fakes.destroy());

runContractSuite(
  ({ logger, sandboxWrapper, cwd }) =>
    new PiHarness({
      logger,
      envScope: true,
      policy: "warn",
      piCommand: fakes.command,
      // A project with its own `.pi/mcp.json`, which pi must never load (--no-approve).
      cwd: cwd ?? fakes.projectDir,
      abortGraceMs: 500,
      killGraceMs: 500,
      // pi has no native sandbox. No host srt probe in tests: case 15 hands in its
      // recording wrapper, every other case runs with the process sandbox off.
      sandboxWrapper: sandboxWrapper ?? null,
      sandbox: "off",
    }),
  fakes,
  "pi",
  {
    // The provider keys, plus the pi process variables the adapter sets itself.
    authVars: [...PI_AUTH_VARS, "PI_CODING_AGENT_DIR", "PI_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_TELEMETRY"],
  },
);
