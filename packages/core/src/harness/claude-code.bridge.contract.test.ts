import { runContractSuite } from "./__contract__/suite.js";
import { createClaudeSdkFake } from "./__contract__/fakes.js";

// ClaudeCodeHarness with skill tools served through the SwenyToolBridge (#414)
// instead of the in-process SDK server. Same suite, same fake: the bridge must
// not change any contract, and its socket must be gone after every run.
const fakes = createClaudeSdkFake();

runContractSuite(
  async ({ logger, sandbox }) => {
    const { ClaudeCodeHarness } = await import("./claude-code.js");
    return new ClaudeCodeHarness({
      logger,
      envScope: true,
      toolBridge: true,
      ...(sandbox ? { sandbox: "auto" as const, sandboxProbe: () => undefined } : { sandbox: "off" as const }),
    });
  },
  fakes,
  "claude-code (tool bridge)",
);
