/**
 * Claude Client - Headless Claude Code backend
 *
 * Uses the @anthropic-ai/claude-agent-sdk to run headless Claude Code
 * as the LLM backend. Tools are exposed via an in-process MCP server
 * that Claude Code calls during execution.
 *
 * This is the ONLY supported LLM backend. The whole point of sweny
 * is to use headless Claude Code - never the raw Anthropic API.
 */

import { query, createSdkMcpServer, tool as sdkTool, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { createRequire } from "node:module";
import type {
  Claude,
  Tool,
  ToolContext,
  NodeResult,
  NodeUsage,
  ToolCall,
  JSONSchema,
  Logger,
  McpServerConfig,
} from "../types.js";
import { consoleLogger } from "../types.js";
import {
  AGENT_AUTH_VARS,
  finishAgentEnv,
  reportWithheldEnv,
  parseList,
  resolveEnvScope,
  scopeAgentEnv,
  withPushBlocked,
  resolveAgentSandbox,
  type AgentAccess,
  type SandboxMode,
} from "../agent-env.js";
import type {
  AgentHarness,
  HarnessCapabilities,
  HarnessCompleteRequest,
  HarnessInfo,
  HarnessRunRequest,
  HarnessRunResult,
  NodePolicy,
  ToolClass,
} from "./types.js";
import { policyGate, type HarnessPolicyMode } from "./policy.js";
import { CLAUDE_CODE_CAPABILITIES } from "./capabilities.js";
import { ask as coreAsk, evaluate as coreEvaluate, buildEvaluatePrompt, buildNodePrompt } from "./prompts.js";
import { jsonSchemaToZodShape, toolErrorToMcpResult, toolOutputToMcpResult } from "./tool-bridge/protocol.js";
import { startToolBridge, type ToolBridge } from "./tool-bridge/server.js";
import { parseToolResultContent, summarizeToolError, tryParseJSON } from "./parse.js";
import { makeAbort } from "./abort.js";
import { claudeCodeAuth, type AuthProbe } from "./auth.js";

export { buildEvaluatePrompt, CLAUDE_CODE_CAPABILITIES };
export { parseToolResultContent, summarizeToolError, makeAbort };

let cachedSdkVersion: string | undefined;

/** Version of the Claude Agent SDK this adapter drives; "unknown" when it cannot be read. */
function claudeSdkVersion(): string {
  if (cachedSdkVersion !== undefined) return cachedSdkVersion;
  try {
    const req = createRequire(import.meta.url);
    const pkg = req("@anthropic-ai/claude-agent-sdk/package.json") as { version?: unknown };
    cachedSdkVersion = typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    cachedSdkVersion = "unknown";
  }
  return cachedSdkVersion;
}

const SYSTEM_PROMPT = `You are a step in an automated workflow. Execute the instruction precisely using the tools available to you. Be thorough but concise. When you're done, summarize your findings and results.`;

/**
 * Built-in tools disallowed for the route-evaluation (`evaluate`) and
 * reflection/judge (`ask`) calls.
 *
 * These are pure classification calls over prior-node data that can be
 * attacker-influenceable (a prior node summarizes an untrusted issue body,
 * PR diff, log line, etc.). They must never be able to mutate the workspace
 * or shell out, regardless of any node's own `disallowed_tools` policy.
 * `maxTurns: 1` already bounds them; this removes the powerful built-ins
 * from the model's context entirely as structural defense-in-depth.
 */
export const CLASSIFICATION_DISALLOWED_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
] as const;

/**
 * Built-in tools disallowed for a node run with `readOnly: true` (dry run,
 * #380): everything that can edit the workspace, shell out (and so reach
 * `gh`, `curl`, `git push`), spawn a subagent that could, or fetch an
 * arbitrary URL (a GET can still trigger a webhook or exfiltrate data).
 * Read, Grep, Glob and WebSearch stay available for analysis.
 */
export const READ_ONLY_DISALLOWED_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Task",
  "Agent",
  "WebFetch",
] as const;

/**
 * Claude Code built-in tool names per portable tool class. A node's
 * `tools.deny` classes compile to these names on `disallowedTools`.
 */
export const CLAUDE_TOOLS_BY_CLASS: Readonly<Record<ToolClass, readonly string[]>> = {
  shell: ["Bash"],
  write: ["Write", "NotebookEdit"],
  edit: ["Edit", "MultiEdit"],
  net: ["WebFetch", "WebSearch"],
  subagent: ["Task", "Agent"],
};

/** Native `disallowedTools` for a policy: legacy names, compiled classes, and the read-only set. */
export function compileClaudeCodeDeny(policy: NodePolicy, legacy: readonly string[] = []): string[] {
  return [
    ...new Set([
      ...legacy,
      ...(policy.nativeDeny ?? []),
      ...policy.deny.flatMap((c) => CLAUDE_TOOLS_BY_CLASS[c] ?? []),
      ...(policy.readOnly ? READ_ONLY_DISALLOWED_TOOLS : []),
    ]),
  ];
}

/** How sweny resolves which credentials reach the Claude Code subprocess. */
export type SwenyAuthMode = "auto" | "api-key" | "oauth";

export interface ResolveAuthEnvOpts {
  /** Explicit override; when absent, read from `env.SWENY_AUTH`. Test seam. */
  mode?: SwenyAuthMode;
  /** Logger for the debug line + invalid-value warning. */
  logger?: Pick<Logger, "debug" | "warn">;
}

/**
 * Decide which auth credentials survive into the Claude Code subprocess env.
 *
 * sweny does not select the winning credential (the spawned agent and any
 * on-disk `~/.claude/.credentials.json` do that). This function only controls
 * what is *present* in the env we hand the agent.
 *
 * Modes (`SWENY_AUTH`, default `auto`):
 *  - `auto`    - today's protective behavior: when an OAuth token is present,
 *                strip `ANTHROPIC_API_KEY` so a stray `.env` key cannot
 *                silently bill a metered API account. `ANTHROPIC_AUTH_TOKEN`
 *                (a bearer token, not a console key) is never touched.
 *  - `api-key` - user explicitly authenticates a gateway with a key/bearer:
 *                preserve both even when an OAuth token is also present.
 *  - `oauth`   - user explicitly wants subscription/OAuth: strip both
 *                `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` so a leftover
 *                credential cannot win at the agent. Fails closed.
 *
 * Base-URL presence is deliberately NOT a signal here: pass-through proxies
 * (corporate egress, observability) set `ANTHROPIC_BASE_URL` while still
 * billing the real key, so inferring "use the key" from a base URL would
 * re-introduce a surprise-billing path. Intent must be explicit.
 *
 * An unrecognized `SWENY_AUTH` value falls back to `auto` with a warning
 * (never throws - an env typo must not crash a CI run).
 *
 * Pure: returns a copy, never mutates the input.
 */
export function resolveAuthEnv(env: Record<string, string>, opts: ResolveAuthEnvOpts = {}): Record<string, string> {
  const out = { ...env };

  const raw = opts.mode ?? env.SWENY_AUTH;
  let mode: SwenyAuthMode = "auto";
  if (raw === "auto" || raw === "api-key" || raw === "oauth") {
    mode = raw;
  } else if (raw) {
    // truthy but unrecognized - empty string falls through silently to auto
    opts.logger?.warn?.(`SWENY_AUTH="${raw}" is not one of auto|api-key|oauth; falling back to auto`);
  }

  // Truthy checks throughout: action.yml sets these to "" when an input is
  // omitted, and empty string must read as unset.
  const hasOauth = !!out.CLAUDE_CODE_OAUTH_TOKEN;

  if (mode === "oauth") {
    delete out.ANTHROPIC_API_KEY;
    delete out.ANTHROPIC_AUTH_TOKEN;
  } else if (mode === "api-key") {
    // preserve key + bearer; do not strip even if an OAuth token is present
  } else {
    // auto - byte-for-byte the historical behavior
    if (hasOauth) {
      delete out.ANTHROPIC_API_KEY;
    }
  }

  // Mode only, never credential values.
  opts.logger?.debug?.(`[sweny] auth mode: ${mode}`);

  return out;
}

export interface ClaudeCodeHarnessOptions {
  /** Model override */
  model?: string;
  /** Max turns for tool use loop (default: 20) */
  maxTurns?: number;
  /** Working directory for Claude Code (default: process.cwd()) */
  cwd?: string;
  /** Logger */
  logger?: Logger;
  /** Default tool context for standalone usage (not via executor) */
  defaultContext?: ToolContext;
  /** Catalog defaults, overridden by per-run skill servers and explicit mcpServers. */
  defaultMcpServers?: Record<string, McpServerConfig>;
  /** Explicit external MCP servers, overriding defaults and per-run skill servers. */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Extra env var names passed to the agent subprocess on top of the
   * allowlist (see agent-env.ts). `"*"` inherits the full environment.
   * Default: `SWENY_ENV_PASSTHROUGH` (comma-separated).
   */
  envPassthrough?: string[];
  /**
   * Scope the agent env to the allowlist. Default: `SWENY_ENV_SCOPE`, else on
   * when CI is truthy and off locally (full env).
   */
  envScope?: boolean;
  /**
   * SDK sandbox for agent commands: `auto` (sandbox when the host supports
   * it, else warn and run unsandboxed), `strict` (sandbox or fail), `off`.
   * Default: `SWENY_SANDBOX`, else `auto` when CI is truthy, `off` otherwise.
   */
  sandbox?: SandboxMode;
  /** Extra hosts sandboxed commands may reach. Default: `SWENY_SANDBOX_ALLOWED_DOMAINS`. */
  sandboxAllowedDomains?: string[];
  /** Sandbox preflight probe (test seam). Returns a reason when the sandbox cannot run. */
  sandboxProbe?: () => string | undefined;
  /** Login probe for `preflight()` (test seam). Default: {@link claudeCodeAuth} over `process.env`. */
  authProbe?: AuthProbe;
  /**
   * Serve skill tools through the SwenyToolBridge (a stdio MCP shim over a
   * per-run unix socket, #414) instead of the in-process SDK MCP server.
   * Same tools, same results; used to run the harness contract suite both
   * ways. Default: off, unless `SWENY_TOOL_BRIDGE=1`.
   */
  toolBridge?: boolean;
  /** Shim command override for the bridge (test seam). Default: this package's `sweny tool-bridge`. */
  toolBridgeShim?: { command: string; args: string[] };
  /**
   * Harness policy mode. Claude Code honors every node opinion natively, so
   * this only decides one case: a staged or dry-run write node whose agent
   * runs unsandboxed is refused under `strict` (its push block is env and git
   * hooks, which a deliberate agent can undo) and reported under `warn`.
   * Default: `warn`; the CLI passes `resolveHarnessPolicy()` (strict under GitHub Actions).
   */
  policy?: HarnessPolicyMode;
}

/**
 * Best-effort interrupt of an SDK query stream. Called from `finally` so an
 * early return / timeout / throw does not leak the underlying subprocess.
 * Swallows errors: the stream may already be done, and interrupt is only
 * supported in streaming-input mode.
 */
// The return type is deliberately `Promise<unknown>`, not `Promise<void>`:
// agent-sdk 0.3 changed `Query.interrupt()` to resolve with an
// SDKControlInterruptResponse. We discard the value either way, and a `void`
// parameter type would reject any SDK that resolves with something.
async function interruptStream(stream: { interrupt?: () => Promise<unknown> } | undefined): Promise<void> {
  if (!stream || typeof stream.interrupt !== "function") return;
  try {
    await stream.interrupt();
  } catch {
    /* already finished or not interruptible - nothing to clean up */
  }
}

/**
 * Extract shape-only usage/cost from an SDK `result` message.
 *
 * Reads `total_cost_usd`, `usage` (in/out/cache tokens), and `num_turns` off
 * the terminal result. Returns undefined when the message carries none of
 * them (mocks, older SDKs) so callers leave `NodeResult.usage` absent rather
 * than shipping an all-zero object. NEVER touches `result`/prompt text.
 */
function extractUsage(resultMsg: unknown): NodeUsage | undefined {
  const m = resultMsg as {
    total_cost_usd?: unknown;
    num_turns?: unknown;
    usage?: {
      input_tokens?: unknown;
      output_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
    };
  };
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const u = m.usage;
  const usage: NodeUsage = {
    costUsd: num(m.total_cost_usd),
    inputTokens: num(u?.input_tokens),
    outputTokens: num(u?.output_tokens),
    cacheReadTokens: num(u?.cache_read_input_tokens),
    cacheCreationTokens: num(u?.cache_creation_input_tokens),
    numTurns: num(m.num_turns),
  };
  // Drop the object entirely when the SDK gave us nothing usable, so a
  // mocked/legacy run reports no usage instead of a misleading zero-cost run.
  return Object.values(usage).some((v) => v !== undefined) ? usage : undefined;
}

export class ClaudeCodeHarness implements Claude, AgentHarness {
  readonly id = "claude-code" as const;
  readonly capabilities: HarnessCapabilities = CLAUDE_CODE_CAPABILITIES;
  readonly defaultJudgeModel = "claude-haiku-4-5";
  private model: string | undefined;
  private maxTurns: number;
  private cwd: string;
  readonly logger: Logger;
  private defaultContext: ToolContext;
  private mcpServers: Record<string, McpServerConfig>;
  private defaultMcpServers: Record<string, McpServerConfig>;
  private envPassthrough: string[] | undefined;
  private sandboxMode: SandboxMode | undefined;
  private sandboxAllowedDomains: string[] | undefined;
  private sandboxProbe: (() => string | undefined) | undefined;
  private sandboxWarned = false;
  private envScope: boolean | undefined;
  private toolBridge: boolean;
  private toolBridgeShim: { command: string; args: string[] } | undefined;
  private authProbe: AuthProbe;
  private policyMode: HarnessPolicyMode;

  constructor(opts: ClaudeCodeHarnessOptions = {}) {
    this.model = opts.model;
    this.maxTurns = opts.maxTurns ?? 20;
    this.cwd = opts.cwd ?? process.cwd();
    this.logger = opts.logger ?? consoleLogger;
    this.defaultContext = opts.defaultContext ?? { config: {}, logger: this.logger };
    this.mcpServers = opts.mcpServers ?? {};
    this.defaultMcpServers = opts.defaultMcpServers ?? {};
    this.envPassthrough = opts.envPassthrough;
    this.envScope = opts.envScope;
    this.sandboxMode = opts.sandbox;
    this.sandboxAllowedDomains = opts.sandboxAllowedDomains;
    this.sandboxProbe = opts.sandboxProbe;
    this.toolBridge = opts.toolBridge ?? process.env.SWENY_TOOL_BRIDGE === "1";
    this.toolBridgeShim = opts.toolBridgeShim;
    this.authProbe = opts.authProbe ?? (() => claudeCodeAuth(process.env));
    this.policyMode = opts.policy ?? "warn";
  }

  /**
   * Build env for the Claude Code subprocess (#360). Applies auth precedence
   * via {@link resolveAuthEnv} on the full process env (it reads
   * `SWENY_AUTH`). When env scoping is on (default in CI, see
   * {@link resolveEnvScope}) the result is narrowed to the allowlist plus
   * `extraVars` (the node's declared skill env vars) and the operator
   * passthrough list, and the withheld names (never values) are reported once
   * per process ({@link reportWithheldEnv}). When off, the full env passes through as before.
   * Either way, skill credentials are then dropped ({@link finishAgentEnv}):
   * only the names the node granted with `agent_env` reach the agent.
   */
  private buildEnv(access?: Pick<AgentAccess, "envVars" | "withhold">): Record<string, string> {
    const full: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
    );
    const authed = resolveAuthEnv(full, { logger: this.logger });
    const passthrough = this.envPassthrough ?? parseList(process.env.SWENY_ENV_PASSTHROUGH);
    let env = authed;
    if (resolveEnvScope(process.env, this.envScope, this.logger)) {
      const scoped = scopeAgentEnv(authed, { extraVars: access?.envVars ?? [], passthrough, logger: this.logger });
      reportWithheldEnv(scoped.withheld, this.logger);
      env = scoped.env;
    }
    return finishAgentEnv(env, { access, keep: AGENT_AUTH_VARS, passthrough, logger: this.logger }).env;
  }

  /** Which harness (and SDK version) produced a result. */
  info(): HarnessInfo {
    return { id: this.id, version: claudeSdkVersion() };
  }

  /** Checks the agent can authenticate (#339): an env credential, Bedrock/Vertex, or a Claude Code login. */
  async preflight(): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
    const auth = this.authProbe();
    if (!auth.ok) return { ok: false, reason: auth.reason };
    return { ok: true, version: claudeSdkVersion() };
  }

  /**
   * Run a node. Runs {@link policyGate} (always `degraded: []` for Claude
   * Code), compiles the policy to native options, and tags the result with the
   * harness id and version.
   *
   * Policy compile (#365): `policy.readOnly` (or the legacy `readOnly` flag)
   * is a read-only run; `policy.deny` classes become native `disallowedTools`
   * names, merged with `nativeDeny` and the legacy `disallowedTools`; and
   * `policy.strict` makes MCP exclusive (`strictMcpConfig`) even for a
   * write-capable node. Per-request sandbox mode overrides the client default,
   * and policy egress supplies the node hosts without dropping scoped env access.
   */
  async run(req: HarnessRunRequest): Promise<HarnessRunResult> {
    const policy: NodePolicy = req.policy ?? {
      readOnly: !!req.readOnly,
      deny: req.deny ?? [],
      nativeDeny: req.disallowedTools,
      egress: req.agentAccess?.domains ?? [],
      strict: false,
    };
    const gate = policyGate(this.capabilities, policy);
    if (gate.refuse) {
      this.logger.error(gate.refuse);
      return {
        status: "failed",
        // `refused` keeps fail_soft from softening a policy refusal (executor.ts).
        data: { error: gate.refuse, refused: true },
        toolCalls: [],
        harness: this.info(),
        degraded: gate.degraded,
      };
    }
    const readOnly = !!req.readOnly || policy.readOnly;
    const disallowedTools = compileClaudeCodeDeny(policy, req.disallowedTools ?? []);
    const degraded = [...gate.degraded];
    const result = await this.runQuery({
      ...req,
      readOnly,
      disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
      strictMcp: readOnly || policy.strict || policy.exclusiveMcp === true,
      sandboxMode: policy.sandbox,
      agentAccess: {
        envVars: req.agentAccess?.envVars ?? [],
        domains: policy.egress,
        withhold: req.agentAccess?.withhold,
        noPush: req.agentAccess?.noPush,
      },
      stagedWrite: !!req.agentAccess?.noPush && !readOnly,
      strict: policy.strict || this.policyMode === "strict",
      degraded,
    });
    return { ...result, harness: this.info(), degraded };
  }

  private async runQuery(opts: {
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
    onProgress?: (message: string) => void;
    maxTurns?: number;
    disallowedTools?: string[];
    model?: string;
    /** Abort the query after this many ms. Default: no timeout (back-compat). */
    timeoutMs?: number;
    /** Caller-supplied abort signal. Aborting it interrupts the query. */
    signal?: AbortSignal;
    /** MCP servers declared by the current node's skills. */
    mcpServers?: Record<string, McpServerConfig>;
    /** Dry run (#380): no external MCP servers, no write-capable built-ins. */
    readOnly?: boolean;
    /** Env var names + sandbox hosts this node's skills need (#360). */
    agentAccess?: AgentAccess;
    /** Exclusive MCP: only the servers passed here load (#365 strict policy). */
    strictMcp?: boolean;
    /** Per-request containment requirement; falls back to the client default. */
    sandboxMode?: SandboxMode;
    /** Live token usage (#449), reported as assistant messages arrive. */
    onUsage?: (usage: NodeUsage) => void;
    /** A write node in a staged or dry run (#442): its push block needs the sandbox to hold. */
    stagedWrite?: boolean;
    /** Refuse instead of degrade (node `permissions.strict`, or the harness policy). */
    strict?: boolean;
    /** Collects what this run cannot honor, for `HarnessRunResult.degraded`. */
    degraded?: string[];
  }): Promise<NodeResult> {
    const {
      instruction,
      context,
      tools,
      outputSchema,
      onProgress,
      maxTurns,
      model,
      timeoutMs,
      signal,
      readOnly,
      agentAccess,
      onUsage,
    } = opts;
    // Dry run (#380): external MCP servers cannot be classified per tool, so
    // they are unknown, and unknown means write. Drop them, and disallow the
    // built-ins that can change the workspace or shell out.
    const disallowedTools = readOnly
      ? [...new Set([...(opts.disallowedTools ?? []), ...READ_ONLY_DISALLOWED_TOOLS])]
      : opts.disallowedTools;
    const effectiveModel = model ?? this.model;

    // #360: run agent commands in the SDK sandbox. `auto` (default in CI) falls
    // back to unsandboxed with one loud warning when the host cannot sandbox;
    // `strict` fails the node here instead.
    const sandbox = resolveAgentSandbox({
      env: process.env,
      mode: opts.sandboxMode ?? this.sandboxMode,
      allowedDomains: this.sandboxAllowedDomains,
      nodeDomains: agentAccess?.domains,
      probe: this.sandboxProbe,
      logger: this.logger,
    });
    if (sandbox.error) {
      this.logger.error(sandbox.error);
      return { status: "failed", data: { error: sandbox.error, refused: true }, toolCalls: [] };
    }
    if (sandbox.warning && !this.sandboxWarned) {
      this.sandboxWarned = true;
      // GitHub Actions renders `::warning::` as a run annotation.
      const prefix = process.env.GITHUB_ACTIONS === "true" ? "::warning title=SWEny agent sandbox::" : "";
      this.logger.warn(`${prefix}${sandbox.warning}`);
    }
    // #442 + security review 2026-09-30 finding 3: with no sandbox, a staged
    // write node's push block is only env and git hooks the agent can undo.
    if (opts.stagedWrite && !sandbox.settings) {
      const gap =
        "no push (staged run): blocked by env and git hooks only; with no sandbox a deliberate agent can undo them and push";
      if (opts.strict) {
        const error = `strict policy: ${gap}`;
        this.logger.error(error);
        return { status: "failed", data: { error, refused: true }, toolCalls: [] };
      }
      opts.degraded?.push(gap);
    }

    // Tool-call accounting (Fix #1).
    //
    // Stream-driven recording, correlated by tool_use_id:
    //   - `assistant` message with tool_use block → create a pending ToolCall
    //     and register it in `pendingByUseId` under its tool_use_id.
    //   - `user` message with tool_result block → look up by tool_use_id, set
    //     `status` from `is_error`, and recover the typed output by parsing
    //     the stringified `content` field (our wrapper JSON-stringifies it
    //     before returning; external MCP servers also return structured
    //     content).
    //
    // Keying by tool_use_id (not by tool name) avoids mis-pairing when
    // Claude invokes the same tool in parallel - the self-review test
    // `pairs parallel same-named in-process tool outputs correctly` shows
    // why FIFO-by-name is wrong.
    const toolCalls: ToolCall[] = [];
    const pendingByUseId = new Map<string, ToolCall>();
    // Live token tally (#449). Each assistant message carries its API
    // message's usage; the SDK repeats one API message across its content
    // blocks, so keep the latest per message id and sum. A lower bound until
    // the terminal `result` message, whose total is authoritative.
    const liveByMessage = new Map<string, { input: number; output: number }>();

    // Convert core tools to SDK MCP tools. The wrapper invokes the user's
    // handler and returns `content` via the MCP transport. We do not push
    // to toolCalls from the wrapper - the stream's tool_result is the sole
    // signal of completion, which keeps pairing correct under parallelism.
    // #414: with the bridge on, the same tools reach Claude Code through the
    // `sweny tool-bridge` stdio shim instead, so no in-process server is built.
    const useBridge = this.toolBridge && tools.length > 0;
    const sdkTools = useBridge ? [] : tools.map((t) => coreToolToSdkTool(t, this.defaultContext));

    // Create in-process MCP server
    const mcpServer = useBridge
      ? undefined
      : createSdkMcpServer({
          name: "sweny-core",
          tools: sdkTools,
        });
    let bridge: ToolBridge | undefined;

    // Build prompt. Context (workflow input such as issues/alerts, plus prior
    // node outputs) is fenced as untrusted data (#360).
    const prompt = buildNodePrompt(instruction, context, outputSchema);

    const env = withPushBlocked(this.buildEnv(agentAccess), agentAccess?.noPush);

    let response = "";
    // CC-08: when the SDK populates typed structured output (because we passed
    // an `outputFormat`), prefer it over re-parsing JSON out of the free-text
    // result. Left undefined when the SDK didn't provide it, so the
    // tryParseJSON heuristic remains the fallback (e.g. mocks, older results).
    let structuredOutput: unknown;
    // Token + cost accounting. Read off the SDK's terminal `result` message
    // (present on both success and error subtypes). Shape-only: counts and
    // cost, never any prompt/response text. Left undefined when the SDK
    // emitted no usage (mocks, older SDKs), so `usage` stays absent rather
    // than shipping zeroes that read as a real (free) run.
    let usage: NodeUsage | undefined;
    // Fail closed: a stream that ends with no terminal `result` message
    // (subprocess died, stream truncated) is not a success.
    let sawResult = false;

    // Timeout / abort wiring (back-compat: only armed when requested).
    // A single AbortController drives both an optional caller signal and an
    // optional timeout timer. The SDK aborts the subprocess when this fires.
    const abort = makeAbort(timeoutMs, signal);
    let stream: ReturnType<typeof query> | undefined;

    try {
      const allMcpServers: Record<string, any> = readOnly
        ? {}
        : { ...this.defaultMcpServers, ...opts.mcpServers, ...this.mcpServers };
      if (useBridge) {
        // Only `tools` (already allow/deny and dry-run filtered by the
        // executor) are exposed. Under readOnly it is still the only MCP
        // server, and strictMcpConfig below keeps it that way.
        bridge = await startToolBridge({
          tools,
          context: this.defaultContext,
          logger: this.logger,
          ...(this.toolBridgeShim ? { shimCommand: this.toolBridgeShim } : {}),
        });
        allMcpServers["sweny-core"] = bridge.mcpServer;
      } else if (sdkTools.length > 0) {
        allMcpServers["sweny-core"] = mcpServer;
      }

      stream = query({
        prompt,
        options: {
          maxTurns: maxTurns ?? this.maxTurns,
          systemPrompt: SYSTEM_PROMPT,
          cwd: this.cwd,
          env,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          ...(sandbox.settings ? { sandbox: sandbox.settings } : {}),
          stderr: (data: string) => this.logger.debug(`[claude-code] ${data}`),
          ...(abort ? { abortController: abort.controller } : {}),
          ...(effectiveModel ? { model: effectiveModel } : {}),
          ...(Object.keys(allMcpServers).length > 0 ? { mcpServers: allMcpServers } : {}),
          // Dry run (#380): settingSources is omitted, so the SDK loads user,
          // project and local settings, including their MCP servers (and
          // project .mcp.json, plugins). strictMcpConfig limits MCP to the
          // servers passed above, which under readOnly is only sweny-core.
          // A strict policy (#365) makes it exclusive for write nodes too.
          ...(readOnly || opts.strictMcp ? { strictMcpConfig: true } : {}),
          ...(disallowedTools && disallowedTools.length > 0 ? { disallowedTools } : {}),
          // CC-08: ask the SDK to produce validated structured output when the
          // node declares an output schema. The SDK then returns the parsed
          // value on `result.structured_output`, which we prefer over the
          // text-scan heuristic below.
          ...(outputSchema ? { outputFormat: { type: "json_schema", schema: outputSchema } } : {}),
        },
      });

      for await (const message of stream) {
        if (message.type === "tool_progress") {
          const tp = message as any;
          if (tp.tool_name && typeof tp.elapsed_time_seconds === "number") {
            const name = stripMcpPrefix(tp.tool_name);
            const secs = Math.round(tp.elapsed_time_seconds);
            onProgress?.(`${name} (${secs}s)`);
          }
        } else if (message.type === "tool_use_summary") {
          const ts = message as any;
          if (ts.summary) {
            const clean = ts.summary.replace(/\n/g, " ").trim();
            onProgress?.(clean.length > 80 ? clean.slice(0, 79) + "\u2026" : clean);
          }
        } else if (message.type === "assistant") {
          // Tool_use blocks start a ToolCall record. Status + output are
          // filled in when the matching user tool_result arrives.
          const am = message as any;
          if (onUsage) {
            const u = am.message?.usage;
            if (u && typeof u === "object") {
              const key = typeof am.message?.id === "string" ? am.message.id : `#${liveByMessage.size}`;
              const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
              const prev = liveByMessage.get(key);
              liveByMessage.set(key, {
                input: Math.max(prev?.input ?? 0, num(u.input_tokens)),
                output: Math.max(prev?.output ?? 0, num(u.output_tokens)),
              });
              let inputTokens = 0;
              let outputTokens = 0;
              for (const v of liveByMessage.values()) {
                inputTokens += v.input;
                outputTokens += v.output;
              }
              onUsage({ inputTokens, outputTokens });
            }
          }
          if (am.message?.content && Array.isArray(am.message.content)) {
            for (const block of am.message.content) {
              if (block.type === "tool_use") {
                const call: ToolCall = {
                  tool: stripMcpPrefix(block.name ?? ""),
                  input: block.input,
                };
                toolCalls.push(call);
                if (typeof block.id === "string") pendingByUseId.set(block.id, call);
              }
            }
          }
        } else if (message.type === "user") {
          // Tool_result blocks close the loop. Pair to the pending ToolCall
          // by tool_use_id - NOT by name, which would break parallel calls
          // of the same tool (see regression test).
          //
          // Output handling is unified across in-process and external tools:
          // our wrapper JSON-stringifies structured output before returning,
          // and external MCP servers also send structured content as string.
          // We parse the content back into a value so verify's output-path
          // checks work against typed data.
          const um = message as any;
          if (um.message?.content && Array.isArray(um.message.content)) {
            for (const block of um.message.content) {
              if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
              const call = pendingByUseId.get(block.tool_use_id);
              if (!call) continue;
              // Delete after first match so a duplicate tool_result (SDK
              // retry, malformed stream) cannot overwrite a completed call.
              pendingByUseId.delete(block.tool_use_id);

              const isError = block.is_error === true;
              call.status = isError ? "error" : "success";
              const parsed = parseToolResultContent(block.content);
              call.output = isError ? { error: parsed } : parsed;

              // Surface tool errors in the CI log stream at warn level so
              // postmortems don't have to reconstruct them from eval-time
              // tool-call summaries. Without this, "eval failed: tool X
              // did not succeed" never answers the WHY question, because
              // the error body is buried in the per-call output captured
              // only for in-memory verify evaluation.
              if (isError) {
                this.logger.warn(`  tool ${call.tool} failed: ${summarizeToolError(parsed)}`);
              }
            }
          }
        } else if (message.type === "result") {
          const resultMsg = message as SDKResultMessage;
          sawResult = true;
          // Capture token/cost accounting off the terminal result. Present on
          // both success and error subtypes; shape-only. Attached to every
          // return below (including early-termination and error paths).
          usage = extractUsage(resultMsg);
          if (resultMsg.subtype === "success" && "result" in resultMsg) {
            // terminal_reason was added in @anthropic-ai/claude-agent-sdk v0.2.91.
            // When the turn budget is exhausted the SDK still emits subtype='success'
            // but sets terminal_reason='max_turns'. Treat anything other than
            // 'completed' (or absent) as a failure so callers are not silently fed
            // incomplete output.
            const terminalReason = (resultMsg as any).terminal_reason as string | undefined;
            if (terminalReason && terminalReason !== "completed") {
              // Preserve whatever partial text the agent produced before the
              // early termination. Callers that fail hard ignore it; a node
              // with `fail_soft: true` passes it downstream as the partial
              // gather/work product instead of dropping it on the floor.
              const partial = typeof resultMsg.result === "string" ? resultMsg.result.trim() : "";
              return {
                status: "failed",
                data: {
                  error: `Claude query terminated early: ${terminalReason}`,
                  ...(partial !== "" ? { summary: partial } : {}),
                },
                toolCalls,
                ...(usage ? { usage } : {}),
              };
            }
            response = resultMsg.result;
            // CC-08: capture the SDK's typed structured output when present.
            if ("structured_output" in resultMsg && resultMsg.structured_output !== undefined) {
              structuredOutput = resultMsg.structured_output;
            }
          } else if ("errors" in resultMsg) {
            const errors = (resultMsg as any).errors as string[] | undefined;
            // CC-08: surface the structured-output failure subtype explicitly
            // so a schema the model can't satisfy fails loudly instead of
            // silently producing empty data.
            const prefix =
              (resultMsg as any).subtype === "error_max_structured_output_retries"
                ? "Claude could not produce output matching the schema: "
                : "";
            return {
              status: "failed",
              data: { error: prefix + (errors?.join("\n") ?? "Execution failed") },
              toolCalls,
              ...(usage ? { usage } : {}),
            };
          }
        }
      }
    } catch (err: any) {
      if (abort?.reason() === "timeout") {
        const msg = `Claude query timed out after ${timeoutMs}ms`;
        this.logger.error(msg);
        return { status: "failed", data: { error: msg }, toolCalls };
      }
      this.logger.error(`Claude Code query failed: ${err.message}`);
      return {
        status: "failed",
        data: { error: err.message },
        toolCalls,
      };
    } finally {
      // Interrupt the subprocess on any exit (early return, throw, or normal
      // completion) so a wedged agent does not leak, and clear the timer so
      // it cannot fire after we are done.
      abort?.clear();
      await interruptStream(stream);
      // #414: the socket and its directory go away with the run.
      await bridge?.close();
    }

    if (!sawResult) {
      const msg = "agent stream ended without a result message";
      this.logger.warn(`Claude Code query: ${msg}; failing closed (${toolCalls.length} tool calls captured).`);
      return {
        status: "failed",
        data: { error: msg },
        toolCalls,
        ...(usage ? { usage } : {}),
      };
    }

    // CC-08: prefer the SDK's validated structured output when it gave us an
    // object. Fall back to the free-text JSON heuristic when it's absent
    // (no schema requested, mocked result, or an older SDK that didn't set it).
    const parsedData =
      structuredOutput && typeof structuredOutput === "object" && !Array.isArray(structuredOutput)
        ? (structuredOutput as Record<string, unknown>)
        : tryParseJSON(response, outputSchema, this.logger);

    return {
      status: "success",
      data: { summary: response, ...parsedData },
      toolCalls,
      ...(usage ? { usage } : {}),
    };
  }

  /**
   * Single completion: no tools, no MCP, one turn. Shared by core `ask()`
   * (retry reflection, judge scoring) and `evaluate()` (route choice); the
   * query options are the ones `ask` and `evaluate` used before the seam.
   * Returns null when the query failed (SDK error, timeout, non-success
   * subtype); callers fail closed.
   */
  async complete(req: HarnessCompleteRequest): Promise<string | null> {
    const { prompt, model, timeoutMs, signal } = req;
    const purpose = req.purpose ?? "ask";
    const DASH = String.fromCharCode(0x2014);

    const env = this.buildEnv();
    let response = "";
    const effectiveModel = model ?? this.model;

    const abort = makeAbort(timeoutMs, signal);
    let failed = false;
    let sawResult = false;
    let stream: ReturnType<typeof query> | undefined;

    try {
      stream = query({
        prompt,
        options: {
          maxTurns: 1,
          cwd: this.cwd,
          env,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          // Route evaluation, reflection and judge scoring are pure
          // classification calls over possibly-attacker-influenceable
          // prior-node data. Never let them shell out or mutate, regardless
          // of the node's own policy.
          // Disable ALL built-in tools (SDK `tools: []`); no MCP servers are passed.
          // The disallow list below stays as a second layer.
          tools: [],
          mcpServers: {},
          strictMcpConfig: true,
          disallowedTools: [...CLASSIFICATION_DISALLOWED_TOOLS],
          stderr: (data: string) => this.logger.debug(`[claude-code] ${data}`),
          ...(abort ? { abortController: abort.controller } : {}),
          ...(effectiveModel ? { model: effectiveModel } : {}),
        },
      });

      for await (const message of stream) {
        if (message.type === "result") {
          const resultMsg = message as SDKResultMessage;
          sawResult = true;
          if (resultMsg.subtype === "success" && "result" in resultMsg) {
            response = resultMsg.result;
          } else {
            // Fail closed. An SDK-level failure (non-success subtype) is NOT a
            // routing decision or an answer. Signal it to the caller (null) so
            // the executor takes an explicit default edge or terminates, never
            // the old fall-through to the first choice.
            failed = true;
            if (purpose === "evaluate") {
              this.logger.warn(
                `claude.evaluate: SDK returned non-success subtype "${resultMsg.subtype}" ${DASH} failing closed (no route decision).`,
              );
            } else {
              this.logger.warn(
                `claude.ask: SDK returned non-success subtype "${resultMsg.subtype}" ${DASH} returning empty string`,
              );
            }
          }
        }
      }
    } catch (err: any) {
      if (purpose === "evaluate") {
        if (abort?.reason() === "timeout") {
          this.logger.warn(`Evaluate query timed out after ${timeoutMs}ms. Failing closed (no route decision).`);
        } else {
          this.logger.warn(`Evaluate query failed: ${err.message}. Failing closed (no route decision).`);
        }
      } else if (abort?.reason() === "timeout") {
        this.logger.warn(`Ask query timed out after ${timeoutMs}ms ${DASH} returning empty string`);
      } else {
        this.logger.warn(`Ask query failed: ${err.message}`);
      }
      return null;
    } finally {
      abort?.clear();
      await interruptStream(stream);
    }

    if (!sawResult) {
      this.logger.warn(`claude.${purpose}: agent stream ended without a result message ${DASH} failing closed.`);
      return null;
    }

    return failed ? null : response;
  }

  /** Route evaluation. Delegates to core {@link coreEvaluate} over {@link complete}. */
  evaluate(opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
    /** Abort the query after this many ms. Default: no timeout (back-compat). */
    timeoutMs?: number;
    /** Caller-supplied abort signal. Aborting it interrupts the query. */
    signal?: AbortSignal;
  }): Promise<string | null> {
    return coreEvaluate(this, opts, this.logger);
  }

  /** Free-text completion. Delegates to core {@link coreAsk} over {@link complete}. */
  ask(opts: {
    instruction: string;
    context: Record<string, unknown>;
    model?: string;
    /** Abort the query after this many ms. Default: no timeout (back-compat). */
    timeoutMs?: number;
    /** Caller-supplied abort signal. Aborting it interrupts the query. */
    signal?: AbortSignal;
  }): Promise<string> {
    return coreAsk(this, opts);
  }
}

/** @deprecated Use {@link ClaudeCodeHarnessOptions}. */
export type ClaudeClientOptions = ClaudeCodeHarnessOptions;

/** @deprecated Use {@link ClaudeCodeHarness} (or `createHarness("claude-code")`). */
export const ClaudeClient = ClaudeCodeHarness;
/** @deprecated Use {@link ClaudeCodeHarness}. */
export type ClaudeClient = ClaudeCodeHarness;

// ─── Tool conversion ────────────────────────────────────────────

/**
 * Convert a core Tool to an SDK MCP tool definition.
 *
 * The wrapper runs the user's handler and returns the MCP `CallToolResult`.
 * Output bookkeeping happens on the stream side (see the tool_result
 * handler in `run()`), keyed by `tool_use_id` - never from inside the
 * wrapper. Keeping the wrapper stateless means parallel calls to the same
 * tool cannot mis-pair outputs.
 *
 * @internal Exported for the tool bridge parity test (#414).
 */
export function coreToolToSdkTool(coreTool: Tool, defaultCtx: ToolContext) {
  const zodShape = jsonSchemaToZodShape(coreTool.input_schema);

  return sdkTool(coreTool.name, coreTool.description, zodShape, async (args: Record<string, unknown>) => {
    try {
      // The executor wraps handlers to inject ToolContext.
      // When used standalone, defaultCtx is the fallback.
      const output = await coreTool.handler(args, defaultCtx);
      // JSON-stringify structured output so the tool_result handler can
      // recover it via parseToolResultContent. Strings pass through. Shared
      // with the tool bridge so both paths return the same content.
      return toolOutputToMcpResult(output);
    } catch (err: any) {
      return toolErrorToMcpResult(err);
    }
  });
}

/** Strip MCP server prefix: "mcp__server__tool" → "tool" */
function stripMcpPrefix(name: string): string {
  const parts = name.split("__");
  if (parts.length >= 3 && parts[0] === "mcp") return parts.slice(2).join("__");
  return name;
}
