import { runContractSuite } from "./__contract__/suite.js";
import { createClaudeSdkFake } from "./__contract__/fakes.js";

// ClaudeCodeHarness over a scripted fake of the Claude Agent SDK (#413). The
// suite passing here is the proof that it encodes today's behavior; every new
// adapter needs only its own `make` and fake.
const fakes = createClaudeSdkFake();

runContractSuite(
  async ({ logger, sandbox }) => {
    const { ClaudeCodeHarness } = await import("./claude-code.js");
    return new ClaudeCodeHarness({
      logger,
      envScope: true,
      ...(sandbox ? { sandbox: "auto" as const, sandboxProbe: () => undefined } : { sandbox: "off" as const }),
    });
  },
  fakes,
  "claude-code",
);
