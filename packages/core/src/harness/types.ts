/**
 * AgentHarness: the seam between the executor and whatever agent runs a node.
 *
 * Design: research/2026-09-30-sota/harness-design.md, section 1. Adapters:
 * Claude Code (`ClaudeCodeHarness`) and Codex (`CodexHarness`). `evaluate` and `ask` are
 * not adapter methods: core builds the prompt and calls `complete()` (see
 * prompts.ts), so every adapter gets routing and judging for free.
 *
 * Browser-safe: types only, no runtime imports.
 */

import type { Claude, Logger, NodeResult } from "../types.js";

export type HarnessId = "claude-code" | "mock" | "codex" | "pi" | "hermes" | "gemini" | `acp:${string}`;

/** Portable tool vocabulary for node policy. */
export type ToolClass = "shell" | "write" | "edit" | "net" | "subagent";

export interface HarnessCapabilities {
  /** native = the harness validates a JSON schema; prompt = sweny prompts, parses, validates. */
  structuredOutput: "native" | "prompt";
  /** full = built-in tool calls are visible with status; skill-only = only skill tools are traced. */
  toolTrace: "full" | "skill-only";
  builtinDeny: "by-name" | "by-class" | "shell-only" | "none";
  /**
   * Tool classes the harness can deny natively on top of what `builtinDeny`
   * implies (Codex: shell-only by name, but web search and subagents are
   * config switches). See `nativeDenyClasses()` in policy.ts.
   */
  denyClasses?: ToolClass[];
  mcp: { inject: boolean; exclusive: "native" | "home-isolation" | "none" };
  /** Native sandbox, before any sweny wrapper. */
  sandbox: { fs: boolean; network: boolean };
  readOnly: "native" | "tool-allowlist" | "none";
  turnLimit: "native" | "watchdog" | "none";
  usage: { tokens: boolean; costUsd: boolean; live: boolean };
  cancel: "signal" | "rpc" | "kill";
  resume: boolean;
}

/** What a node is allowed to do, compiled per adapter by the harness. */
export interface NodePolicy {
  /** Dry run: the node must not change anything. */
  readOnly: boolean;
  /** Portable deny list. */
  deny: ToolClass[];
  /** Legacy `disallowed_tools` passthrough, harness-native names. */
  nativeDeny?: string[];
  /** Allowed egress hosts. */
  egress: string[];
  /** Refuse instead of degrade when an opinion cannot be enforced. */
  strict: boolean;
  /**
   * Turn budget for the run. Set by adapters whose `turnLimit` is not native,
   * so the gate reports how the budget is kept (watchdog) or that it is not.
   */
  maxTurns?: number;
  /**
   * Process sandbox mode (`SWENY_SANDBOX`, #360). `auto` and `strict` need fs
   * and network containment: native, or a process wrapper (sandbox-wrapper.ts).
   * `strict` refuses the node without it, even when `strict` above is false.
   * Unset means `off`: no requirement.
   */
  sandbox?: "off" | "auto" | "strict";
}

/** Process-level wrappers the host provides (OS sandbox, egress proxy, read-only mount). */
export interface PolicyWrappers {
  /** A process wrapper contains the agent's filesystem and network (sandbox-wrapper.ts). */
  sandbox?: boolean;
  egress?: boolean;
  readOnlyMount?: boolean;
}

export interface PolicyGateResult {
  /** Every opinion this run could not honor natively. Empty for Claude Code. */
  degraded: string[];
  /** Set only in strict mode when at least one opinion cannot be honored. */
  refuse?: string;
}

/** Which harness produced a result. Recorded on `NodeResult` and in run history. */
export interface HarnessInfo {
  id: HarnessId;
  version: string;
}

/** `Claude.run` request shape, kept verbatim so every existing caller still type-checks. */
export type ClaudeRunRequest = Parameters<Claude["run"]>[0];

export interface HarnessRunRequest extends ClaudeRunRequest {
  /**
   * Node policy. Optional: when absent the adapter derives it from the legacy
   * `readOnly` / `disallowedTools` / `agentAccess` fields.
   */
  policy?: NodePolicy;
}

export interface HarnessRunResult extends NodeResult {
  harness: HarnessInfo;
  degraded: string[];
}

export interface HarnessCompleteRequest {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Which core call this is for. Adapters use it only to word their failure
   * logs ("claude.ask: ..." vs "claude.evaluate: ..."); it never changes the query.
   */
  purpose?: "ask" | "evaluate";
}

export interface AgentHarness {
  readonly id: HarnessId;
  readonly capabilities: HarnessCapabilities;
  /** Default model for judge evaluators when nothing else names one. */
  readonly defaultJudgeModel?: string;
  /** Logger the adapter reports to; core reuses it for routing parse warnings. */
  readonly logger?: Logger;
  preflight(): Promise<{ ok: true; version: string } | { ok: false; reason: string }>;
  run(req: HarnessRunRequest): Promise<HarnessRunResult>;
  /** One completion, no tools, no MCP. null = failed (callers fail closed). */
  complete(req: HarnessCompleteRequest): Promise<string | null>;
}
