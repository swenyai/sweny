/**
 * Harness seam entry point: the factory, the legacy-`Claude` bridge, and the
 * public harness types. Every construction site goes through `createHarness`.
 */

import { ClaudeCodeHarness, type ClaudeCodeHarnessOptions } from "./claude-code.js";
export { claudeCompat, asClaude } from "./compat.js";

export type {
  AgentHarness,
  HarnessCapabilities,
  HarnessCompleteRequest,
  HarnessId,
  HarnessInfo,
  HarnessRunRequest,
  HarnessRunResult,
  NodePolicy,
  PolicyGateResult,
  PolicyWrappers,
  ToolClass,
} from "./types.js";
export { policyGate } from "./policy.js";
export { ask, evaluate, buildAskPrompt, buildEvaluatePrompt } from "./prompts.js";
export { ClaudeCodeHarness, CLAUDE_CODE_CAPABILITIES } from "./claude-code.js";
export type { ClaudeCodeHarnessOptions } from "./claude-code.js";
export { startToolBridge } from "./tool-bridge/server.js";
export type { ToolBridge, ToolBridgeOptions } from "./tool-bridge/server.js";

/**
 * Build the harness for an agent id. `claude` is the historical `--agent` /
 * `coding-agent-provider` value and means the same as `claude-code`.
 * Unknown ids fail with the same error `sweny` has always given.
 */
export function createHarness(id: string, opts: ClaudeCodeHarnessOptions = {}): ClaudeCodeHarness {
  switch (id) {
    case "claude":
    case "claude-code":
      return new ClaudeCodeHarness(opts);
    default:
      throw new Error(
        `Unsupported coding agent "${id}": the only supported agent is "claude" ` +
          `(headless Claude Code). Remove --agent / coding-agent-provider or set it to claude.`,
      );
  }
}
