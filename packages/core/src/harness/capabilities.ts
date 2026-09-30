/**
 * Declared capabilities per adapter. No runtime imports, so the executor can use
 * them without pulling in an agent SDK.
 */

import type { HarnessCapabilities } from "./types.js";

/** Claude Code enforces every sweny opinion natively, so `policyGate` never degrades or refuses it. */
export const CLAUDE_CODE_CAPABILITIES: HarnessCapabilities = {
  structuredOutput: "native",
  toolTrace: "full",
  builtinDeny: "by-name",
  mcp: { inject: true, exclusive: "native" },
  sandbox: { fs: true, network: true },
  readOnly: "native",
  turnLimit: "native",
  usage: { tokens: true, costUsd: true, live: false },
  cancel: "signal",
  resume: false,
};
