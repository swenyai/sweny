import { afterAll, vi } from "vitest";
import { runContractSuite } from "./__contract__/suite.js";
import { createCodexProcessFake } from "./__contract__/fakes.js";
import { CODEX_AUTH_VARS } from "../agent-env.js";
import { CodexHarness } from "./codex.js";

// CodexHarness over a scripted fake `codex` process (#331). The fake parses the
// argv, env and stdin the adapter hands it the way `codex exec` would and
// answers in the `codex exec --json` event schema. No model is called.
// Each case spawns real (fake) processes, several per case; give a loaded CI runner room.
vi.setConfig({ testTimeout: 60_000 });

const fakes = createCodexProcessFake();
afterAll(() => fakes.destroy());

runContractSuite(
  ({ logger, sandbox }) =>
    new CodexHarness({
      logger,
      envScope: true,
      policy: "warn",
      codexCommand: fakes.command,
      killGraceMs: 500,
      ...(sandbox ? { sandbox: "auto" as const, sandboxProbe: () => undefined } : { sandbox: "off" as const }),
    }),
  fakes,
  "codex",
  { authVars: CODEX_AUTH_VARS },
);
