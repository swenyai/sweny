/**
 * Harness seam entry point: the factory, the legacy-`Claude` bridge, and the
 * public harness types. Every construction site goes through `createHarness`.
 */

import { ClaudeCodeHarness, type ClaudeCodeHarnessOptions } from "./claude-code.js";
import { CodexHarness, type CodexHarnessOptions } from "./codex.js";
import { PiHarness, type PiHarnessOptions } from "./pi.js";
import { unsupportedAgentError } from "./agents.js";
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
export { policyGate, nativeDenyClasses, resolveHarnessPolicy, isToolClass, TOOL_CLASSES } from "./policy.js";
export type { HarnessPolicyMode } from "./policy.js";
export { ask, evaluate, buildAskPrompt, buildEvaluatePrompt } from "./prompts.js";
export { ClaudeCodeHarness, CLAUDE_CODE_CAPABILITIES } from "./claude-code.js";
export type { ClaudeCodeHarnessOptions } from "./claude-code.js";
export { CodexHarness, CODEX_CAPABILITIES, MIN_CODEX_VERSION } from "./codex.js";
export type { CodexHarnessOptions } from "./codex.js";
export { PiHarness, PI_CAPABILITIES, MIN_PI_VERSION } from "./pi.js";
export type { PiHarnessOptions } from "./pi.js";
export { startToolBridge } from "./tool-bridge/server.js";
export type { ToolBridge, ToolBridgeOptions } from "./tool-bridge/server.js";

export { SUPPORTED_AGENTS, isSupportedAgent, unsupportedAgentError } from "./agents.js";
export type { SupportedAgent } from "./agents.js";

/**
 * Build the harness for an agent id. `claude` is the historical `--agent` /
 * `coding-agent-provider` value and means the same as `claude-code`.
 * Unknown ids throw: sweny never runs one agent under another's name.
 */
export function createHarness(id: "claude" | "claude-code", opts?: ClaudeCodeHarnessOptions): ClaudeCodeHarness;
export function createHarness(id: "codex", opts?: CodexHarnessOptions): CodexHarness;
export function createHarness(id: "pi", opts?: PiHarnessOptions): PiHarness;
export function createHarness(
  id: string,
  opts?: ClaudeCodeHarnessOptions & CodexHarnessOptions & PiHarnessOptions,
): ClaudeCodeHarness | CodexHarness | PiHarness;
export function createHarness(
  id: string,
  opts: ClaudeCodeHarnessOptions & CodexHarnessOptions & PiHarnessOptions = {},
): ClaudeCodeHarness | CodexHarness | PiHarness {
  switch (id) {
    case "claude":
    case "claude-code":
      return new ClaudeCodeHarness(opts);
    case "codex":
      return new CodexHarness(opts);
    case "pi":
      return new PiHarness(opts);
    default:
      throw new Error(unsupportedAgentError(id));
  }
}
