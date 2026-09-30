/**
 * Claude Client — Headless Claude Code backend
 *
 * Uses the @anthropic-ai/claude-agent-sdk to run headless Claude Code
 * as the LLM backend. Tools are exposed via an in-process MCP server
 * that Claude Code calls during execution.
 *
 * This is the ONLY supported LLM backend. The whole point of sweny
 * is to use headless Claude Code — never the raw Anthropic API.
 */

import { query, createSdkMcpServer, tool as sdkTool, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
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
} from "./types.js";
import { consoleLogger } from "./types.js";
import {
  formatWithheldWarning,
  parseList,
  resolveEnvScope,
  scopeAgentEnv,
  resolveAgentSandbox,
  type AgentAccess,
  type SandboxMode,
} from "./agent-env.js";
import { fenceUntrustedJson } from "./untrusted.js";

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
 *  - `auto`    — today's protective behavior: when an OAuth token is present,
 *                strip `ANTHROPIC_API_KEY` so a stray `.env` key cannot
 *                silently bill a metered API account. `ANTHROPIC_AUTH_TOKEN`
 *                (a bearer token, not a console key) is never touched.
 *  - `api-key` — user explicitly authenticates a gateway with a key/bearer:
 *                preserve both even when an OAuth token is also present.
 *  - `oauth`   — user explicitly wants subscription/OAuth: strip both
 *                `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` so a leftover
 *                credential cannot win at the agent. Fails closed.
 *
 * Base-URL presence is deliberately NOT a signal here: pass-through proxies
 * (corporate egress, observability) set `ANTHROPIC_BASE_URL` while still
 * billing the real key, so inferring "use the key" from a base URL would
 * re-introduce a surprise-billing path. Intent must be explicit.
 *
 * An unrecognized `SWENY_AUTH` value falls back to `auto` with a warning
 * (never throws — an env typo must not crash a CI run).
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
    // truthy but unrecognized — empty string falls through silently to auto
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
    // auto — byte-for-byte the historical behavior
    if (hasOauth) {
      delete out.ANTHROPIC_API_KEY;
    }
  }

  // Mode only, never credential values.
  opts.logger?.debug?.(`[sweny] auth mode: ${mode}`);

  return out;
}

export interface ClaudeClientOptions {
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
  /** External MCP servers (GitHub, Linear, Sentry, etc.) — merged with core skill tools */
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
}

/**
 * Wire an optional timeout + caller signal onto a single AbortController.
 *
 * Returns undefined when neither a timeout nor a signal is supplied so the
 * default code path (no abortController, no timer) is byte-for-byte unchanged.
 *
 * `reason()` reports whether the abort came from the timeout timer or an
 * external signal, so callers can log a distinct timeout message.
 */
export function makeAbort(
  timeoutMs?: number,
  signal?: AbortSignal,
): { controller: AbortController; clear: () => void; reason: () => "timeout" | "signal" | undefined } | undefined {
  if (!timeoutMs && !signal) return undefined;

  const controller = new AbortController();
  let reason: "timeout" | "signal" | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onSignalAbort = () => {
    if (controller.signal.aborted) return;
    reason = "signal";
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      reason = "signal";
      controller.abort();
    } else {
      signal.addEventListener("abort", onSignalAbort, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      reason = "timeout";
      controller.abort();
    }, timeoutMs);
    // Don't keep the event loop alive just for the abort timer.
    (timer as any)?.unref?.();
  }

  return {
    controller,
    reason: () => reason,
    clear: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onSignalAbort);
    },
  };
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
    /* already finished or not interruptible — nothing to clean up */
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

export class ClaudeClient implements Claude {
  private model: string | undefined;
  private maxTurns: number;
  private cwd: string;
  private logger: Logger;
  private defaultContext: ToolContext;
  private mcpServers: Record<string, McpServerConfig>;
  private envPassthrough: string[] | undefined;
  private sandboxMode: SandboxMode | undefined;
  private sandboxAllowedDomains: string[] | undefined;
  private sandboxProbe: (() => string | undefined) | undefined;
  private sandboxWarned = false;
  private envScope: boolean | undefined;
  private envWarned = false;

  constructor(opts: ClaudeClientOptions = {}) {
    this.model = opts.model;
    this.maxTurns = opts.maxTurns ?? 20;
    this.cwd = opts.cwd ?? process.cwd();
    this.logger = opts.logger ?? consoleLogger;
    this.defaultContext = opts.defaultContext ?? { config: {}, logger: this.logger };
    this.mcpServers = opts.mcpServers ?? {};
    this.envPassthrough = opts.envPassthrough;
    this.envScope = opts.envScope;
    this.sandboxMode = opts.sandbox;
    this.sandboxAllowedDomains = opts.sandboxAllowedDomains;
    this.sandboxProbe = opts.sandboxProbe;
  }

  /**
   * Build env for the Claude Code subprocess (#360). Applies auth precedence
   * via {@link resolveAuthEnv} on the full process env (it reads
   * `SWENY_AUTH`). When env scoping is on (default in CI, see
   * {@link resolveEnvScope}) the result is narrowed to the allowlist plus
   * `extraVars` (the node's declared skill env vars) and the operator
   * passthrough list, and the withheld names (never values) are warned once
   * per client. When off, the full env passes through as before.
   */
  private buildEnv(extraVars: readonly string[] = []): Record<string, string> {
    const full: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
    );
    const authed = resolveAuthEnv(full, { logger: this.logger });
    if (!resolveEnvScope(process.env, this.envScope, this.logger)) return authed;
    const { env, withheld } = scopeAgentEnv(authed, {
      extraVars,
      passthrough: this.envPassthrough ?? parseList(process.env.SWENY_ENV_PASSTHROUGH),
      logger: this.logger,
    });
    if (withheld.length > 0 && !this.envWarned) {
      this.envWarned = true;
      const prefix = process.env.GITHUB_ACTIONS === "true" ? "::warning title=SWEny agent env::" : "";
      this.logger.warn(`${prefix}${formatWithheldWarning(withheld)}`);
    }
    return env;
  }

  async run(opts: {
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
    /** Dry run (#380): no external MCP servers, no write-capable built-ins. */
    readOnly?: boolean;
    /** Env var names + sandbox hosts this node's skills need (#360). */
    agentAccess?: AgentAccess;
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
      mode: this.sandboxMode,
      allowedDomains: this.sandboxAllowedDomains,
      nodeDomains: agentAccess?.domains,
      probe: this.sandboxProbe,
      logger: this.logger,
    });
    if (sandbox.error) {
      this.logger.error(sandbox.error);
      return { status: "failed", data: { error: sandbox.error }, toolCalls: [] };
    }
    if (sandbox.warning && !this.sandboxWarned) {
      this.sandboxWarned = true;
      // GitHub Actions renders `::warning::` as a run annotation.
      const prefix = process.env.GITHUB_ACTIONS === "true" ? "::warning title=SWEny agent sandbox::" : "";
      this.logger.warn(`${prefix}${sandbox.warning}`);
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
    // Claude invokes the same tool in parallel — the self-review test
    // `pairs parallel same-named in-process tool outputs correctly` shows
    // why FIFO-by-name is wrong.
    const toolCalls: ToolCall[] = [];
    const pendingByUseId = new Map<string, ToolCall>();

    // Convert core tools to SDK MCP tools. The wrapper invokes the user's
    // handler and returns `content` via the MCP transport. We do not push
    // to toolCalls from the wrapper — the stream's tool_result is the sole
    // signal of completion, which keeps pairing correct under parallelism.
    const sdkTools = tools.map((t) => coreToolToSdkTool(t, this.defaultContext));

    // Create in-process MCP server
    const mcpServer = createSdkMcpServer({
      name: "sweny-core",
      tools: sdkTools,
    });

    // Build prompt. Context (workflow input such as issues/alerts, plus prior
    // node outputs) is fenced as untrusted data (#360).
    const prompt = [
      `## Instruction\n\n${instruction}`,
      `## Context\n\n${fenceUntrustedJson(context, "context")}`,
      outputSchema
        ? `## Required Output\n\nYou MUST end with a JSON object matching this schema:\n\`\`\`json\n${JSON.stringify(outputSchema, null, 2)}\n\`\`\``
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const env = this.buildEnv(agentAccess?.envVars);

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

    // Timeout / abort wiring (back-compat: only armed when requested).
    // A single AbortController drives both an optional caller signal and an
    // optional timeout timer. The SDK aborts the subprocess when this fires.
    const abort = makeAbort(timeoutMs, signal);
    let stream: ReturnType<typeof query> | undefined;

    try {
      const allMcpServers: Record<string, any> = readOnly ? {} : { ...this.mcpServers };
      if (sdkTools.length > 0) allMcpServers["sweny-core"] = mcpServer;

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
          ...(readOnly ? { strictMcpConfig: true } : {}),
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
          // by tool_use_id — NOT by name, which would break parallel calls
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

  async evaluate(opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
    /** Abort the query after this many ms. Default: no timeout (back-compat). */
    timeoutMs?: number;
    /** Caller-supplied abort signal. Aborting it interrupts the query. */
    signal?: AbortSignal;
  }): Promise<string | null> {
    const { question, context, choices, timeoutMs, signal } = opts;
    const prompt = buildEvaluatePrompt(question, context, choices);

    const env = this.buildEnv();

    let response = "";

    const abort = makeAbort(timeoutMs, signal);
    let sdkFailed = false;
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
          // Route evaluation is a pure classification call over
          // possibly-attacker-influenceable prior-node data. Never let it
          // shell out or mutate, regardless of the node's own policy.
          // Disable ALL built-in tools (SDK `tools: []`); no MCP servers are passed.
          // The disallow list below stays as a second layer.
          tools: [],
          mcpServers: {},
          strictMcpConfig: true,
          disallowedTools: [...CLASSIFICATION_DISALLOWED_TOOLS],
          stderr: (data: string) => this.logger.debug(`[claude-code] ${data}`),
          ...(abort ? { abortController: abort.controller } : {}),
          ...(this.model ? { model: this.model } : {}),
        },
      });

      for await (const message of stream) {
        if (message.type === "result") {
          const resultMsg = message as SDKResultMessage;
          if (resultMsg.subtype === "success" && "result" in resultMsg) {
            response = resultMsg.result;
          } else {
            // Fail closed. An SDK-level failure (non-success subtype) is NOT a
            // routing decision. Signal it to the caller (null) so the executor
            // takes an explicit default edge or terminates — never the old
            // fall-through to the first choice, which silently routed an outage
            // down the first conditional edge (e.g. filing a real issue/PR).
            sdkFailed = true;
            this.logger.warn(
              `claude.evaluate: SDK returned non-success subtype "${resultMsg.subtype}" — failing closed (no route decision).`,
            );
          }
        }
      }
    } catch (err: any) {
      if (abort?.reason() === "timeout") {
        this.logger.warn(`Evaluate query timed out after ${timeoutMs}ms. Failing closed (no route decision).`);
      } else {
        this.logger.warn(`Evaluate query failed: ${err.message}. Failing closed (no route decision).`);
      }
      return null;
    } finally {
      abort?.clear();
      await interruptStream(stream);
    }

    // An SDK-level failure already logged a distinct message; fail closed.
    if (sdkFailed) return null;

    const text = response.trim().replace(/^["']|["']$/g, "");
    const validIds = choices.map((c) => c.id);

    // Exact match
    if (validIds.includes(text)) return text;

    // Fuzzy — look for an ID embedded in the response
    const match = validIds.find((id) => text.includes(id));
    if (match) return match;

    // Fail closed. An unparseable answer is not a decision. Returning
    // validIds[0] here is the fail-open bug: on a node with a single
    // conditional out-edge, the "first choice" is always that edge, so a
    // garbled model answer would always take it. Signal no-decision instead.
    this.logger.warn(`Could not parse route choice from: "${text.slice(0, 100)}". Failing closed (no route decision).`);
    return null;
  }

  async ask(opts: {
    instruction: string;
    context: Record<string, unknown>;
    model?: string;
    /** Abort the query after this many ms. Default: no timeout (back-compat). */
    timeoutMs?: number;
    /** Caller-supplied abort signal. Aborting it interrupts the query. */
    signal?: AbortSignal;
  }): Promise<string> {
    const { instruction, context, model, timeoutMs, signal } = opts;
    const prompt = [
      instruction,
      Object.keys(context).length > 0 ? `\nContext:\n${fenceUntrustedJson(context, "context")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const env = this.buildEnv();
    let response = "";
    const effectiveModel = model ?? this.model;

    const abort = makeAbort(timeoutMs, signal);
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
          // Reflection and judge scoring are pure classification calls over
          // possibly-attacker-influenceable prior-node data. Deny the powerful
          // built-ins so they can never shell out or mutate the workspace.
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
          if (resultMsg.subtype === "success" && "result" in resultMsg) {
            response = resultMsg.result;
          } else {
            this.logger.warn(
              `claude.ask: SDK returned non-success subtype "${resultMsg.subtype}" — returning empty string`,
            );
          }
        }
      }
    } catch (err: any) {
      if (abort?.reason() === "timeout") {
        this.logger.warn(`Ask query timed out after ${timeoutMs}ms — returning empty string`);
      } else {
        this.logger.warn(`Ask query failed: ${err.message}`);
      }
      return "";
    } finally {
      abort?.clear();
      await interruptStream(stream);
    }

    return response.trim();
  }
}

// ─── Tool conversion ────────────────────────────────────────────

/**
 * Convert a core Tool to an SDK MCP tool definition.
 *
 * The wrapper runs the user's handler and returns the MCP `CallToolResult`.
 * Output bookkeeping happens on the stream side (see the tool_result
 * handler in `run()`), keyed by `tool_use_id` — never from inside the
 * wrapper. Keeping the wrapper stateless means parallel calls to the same
 * tool cannot mis-pair outputs.
 */
function coreToolToSdkTool(coreTool: Tool, defaultCtx: ToolContext) {
  const zodShape = jsonSchemaToZodShape(coreTool.input_schema);

  return sdkTool(coreTool.name, coreTool.description, zodShape, async (args: Record<string, unknown>) => {
    try {
      // The executor wraps handlers to inject ToolContext.
      // When used standalone, defaultCtx is the fallback.
      const output = await coreTool.handler(args, defaultCtx);
      // JSON-stringify structured output so the tool_result handler can
      // recover it via parseToolResultContent. Strings pass through.
      return {
        content: [{ type: "text" as const, text: typeof output === "string" ? output : JSON.stringify(output) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });
}

/**
 * Best-effort recovery of typed output from a tool_result's `content`.
 *
 * The MCP protocol sends tool results as string content. Our in-process
 * wrapper JSON-stringifies structured output before returning; external
 * MCP servers generally do the same for JSON payloads. If the string
 * looks like a JSON object or array and parses, return the parsed value
 * so verify's output-path walks work against typed data.
 *
 * Raw strings are preserved verbatim. JSON-primitive strings (e.g. the
 * literal four characters `"42"`) are intentionally NOT parsed — we
 * cannot distinguish a tool that returned the number 42 (wrapper sends
 * `"42"`) from a tool that returned the string "42" (wrapper also sends
 * `"42"`). Preserving the string is safer than guessing.
 */
/**
 * Build the prompt used by `ClaudeClient.evaluate()` to pick a routing edge.
 *
 * Extracted as a pure function so the prompt body can be unit tested without
 * spinning up an SDK query. The body is part of the routing contract: workflow
 * authors and downstream maintainers rely on the model leaning on structured
 * fields rather than prose narrative when picking an edge, especially in the
 * fallback case where a source node did not declare an `output` schema (the
 * executor's schema-strict filter only kicks in when a schema is present;
 * see `buildRouteEvalEntry` in executor.ts).
 *
 * Any change to this prompt should keep:
 *   - The three "Evaluation rules" pointing the model at structured fields
 *     and away from prose narrative.
 *   - A terminal directive to return ONLY the choice ID.
 */
export function buildEvaluatePrompt(
  question: string,
  context: Record<string, unknown>,
  choices: { id: string; description: string }[],
): string {
  const choiceList = choices.map((c) => `- "${c.id}": ${c.description}`).join("\n");
  return [
    question,
    `\nContext:\n${fenceUntrustedJson(context, "context")}`,
    `\nChoices:\n${choiceList}`,
    `\nEvaluation rules:`,
    `1. Read each choice's condition literally and match against the structured fields in the context (e.g. status, counts, enum values, boolean flags).`,
    `2. Ignore prose narrative fields ("summary", free-form rationale, conversational commentary). They are not the contract.`,
    `3. When a field's value contradicts what a prose field claims, trust the field's value.`,
    `4. A field whose value is explicitly null means the source node DECLARED that field but did NOT emit a value. Treat null as "unknown" and do NOT match it against any specific value (do not match "is 0", "is N", "is true", "is false", or "is undefined" against a null field). Prefer a default/fallback edge when the field needed for a decision is null.`,
    `\nRespond with ONLY the choice ID, nothing else.`,
  ].join("\n");
}

export function parseToolResultContent(content: unknown): unknown {
  // The Anthropic tool_result `content` field can be a block array
  // (e.g. [{type:"text",text:"..."}, ...]) rather than a string. When it is,
  // concatenate the text of every {type:"text"} block (recursing through any
  // nested content), then run the same object/array JSON-parse logic on the
  // joined string. This keeps `call.output` the actual payload instead of the
  // raw wrapper array that eval/route logic would otherwise have to walk.
  if (Array.isArray(content)) {
    const text = collectBlockText(content);
    return parseJsonObjectOrArray(text);
  }
  if (typeof content !== "string") return content;
  return parseJsonObjectOrArray(content);
}

/**
 * Parse a string only when it is an unambiguous JSON object or array.
 *
 * Strings, numbers, booleans, and null would all corrupt or discard
 * information (we cannot distinguish the literal text `"42"` from the number
 * 42), so non-object/array inputs are preserved verbatim.
 */
function parseJsonObjectOrArray(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.length === 0) return content;
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return content;
  try {
    return JSON.parse(trimmed);
  } catch {
    return content;
  }
}

/**
 * Concatenate the text of an array of content blocks. Handles {type:"text"}
 * blocks and recurses into any nested `content` array so deeply-wrapped tool
 * results still flatten to their underlying text.
 */
function collectBlockText(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (Array.isArray(b.content)) {
      parts.push(collectBlockText(b.content));
    } else if (typeof b.text === "string") {
      // Some producers omit an explicit type but still carry text.
      parts.push(b.text);
    }
  }
  return parts.join("");
}

/**
 * Produce a short, single-line description of a tool-error payload suitable
 * for the CI log stream. The full parsed value stays on the ToolCall for
 * verify and downstream tooling — this is only for inline observability.
 *
 * Collapses newlines, trims whitespace, and caps to 300 chars so a huge
 * API response body doesn't flood the log.
 */
export function summarizeToolError(parsed: unknown): string {
  let raw: string;
  if (typeof parsed === "string") {
    raw = parsed;
  } else if (parsed && typeof parsed === "object") {
    try {
      raw = JSON.stringify(parsed);
    } catch {
      raw = String(parsed);
    }
  } else {
    raw = String(parsed);
  }
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 300 ? collapsed.slice(0, 297) + "..." : collapsed;
}

// ─── JSON Schema → Zod conversion ───────────────────────────────

/**
 * Convert a JSON Schema object to a Zod raw shape for the agent SDK.
 * Preserves property names, types, and descriptions so Claude sees
 * accurate tool parameters through the MCP protocol.
 */
function jsonSchemaToZodShape(schema: JSONSchema): Record<string, z.ZodType> {
  const props = (schema as any)?.properties ?? {};
  const required = new Set<string>((schema as any)?.required ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, prop] of Object.entries(props)) {
    let zodType = jsonPropertyToZod(prop as Record<string, unknown>);
    if (!required.has(key)) {
      zodType = zodType.optional();
    }
    shape[key] = zodType;
  }

  return shape;
}

function jsonPropertyToZod(prop: Record<string, unknown>): z.ZodType {
  if (!prop || typeof prop !== "object") return z.unknown();

  const desc = typeof prop.description === "string" ? prop.description : undefined;

  switch (prop.type) {
    case "string": {
      if (prop.enum && Array.isArray(prop.enum)) {
        const e = z.enum(prop.enum as [string, ...string[]]);
        return desc ? e.describe(desc) : e;
      }
      const s = z.string();
      return desc ? s.describe(desc) : s;
    }
    case "number":
    case "integer": {
      const n = z.number();
      return desc ? n.describe(desc) : n;
    }
    case "boolean": {
      const b = z.boolean();
      return desc ? b.describe(desc) : b;
    }
    case "array": {
      const items = prop.items ? jsonPropertyToZod(prop.items as Record<string, unknown>) : z.unknown();
      const a = z.array(items);
      return desc ? a.describe(desc) : a;
    }
    case "object": {
      if (prop.properties && typeof prop.properties === "object") {
        const nested = jsonSchemaToZodShape(prop as JSONSchema);
        const o = z.object(nested);
        return desc ? o.describe(desc) : o;
      }
      const r = z.record(z.string(), z.unknown());
      return desc ? r.describe(desc) : r;
    }
    default: {
      const u = z.unknown();
      return desc ? u.describe(desc) : u;
    }
  }
}

/** Strip MCP server prefix: "mcp__server__tool" → "tool" */
function stripMcpPrefix(name: string): string {
  const parts = name.split("__");
  if (parts.length >= 3 && parts[0] === "mcp") return parts.slice(2).join("__");
  return name;
}

// ─── JSON extraction ────────────────────────────────────────────

/**
 * Extract a JSON object from Claude's text response.
 *
 * Strategy (in order):
 * 1. LAST ```json code block``` — models put their real final answer last, so
 *    a prompt-injected fake fenced block placed earlier must not win.
 * 2. Last brace-delimited `{...}` block — handles inline JSON at end of text
 * 3. Full text parse — for responses that are pure JSON
 * 4. Empty object — safe fallback
 *
 * When `outputSchema` is supplied, the parsed object is checked against it.
 * A mismatch is logged (warning) rather than silently accepted, so a
 * non-conforming model answer is at least attributable.
 */
function tryParseJSON(text: string, outputSchema?: JSONSchema, logger?: Pick<Logger, "warn">): Record<string, unknown> {
  if (!text) return {};

  const finalize = (parsed: Record<string, unknown>): Record<string, unknown> => {
    if (outputSchema) {
      const problems = schemaMismatches(parsed, outputSchema);
      if (problems.length > 0) {
        logger?.warn?.(`Claude output did not conform to outputSchema: ${problems.join("; ")}`);
      }
    }
    return parsed;
  };

  // 1. Code block — scan ALL fenced blocks, prefer the LAST that parses.
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(fences[i][1].trim());
      if (typeof parsed === "object" && parsed !== null) return finalize(parsed);
    } catch {
      /* try the next-earlier fence, then fall through to brace scan */
    }
  }

  // 2. Last brace-delimited block (scan backwards for matching braces)
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace !== -1) {
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{") depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(i, lastBrace + 1));
          if (typeof parsed === "object" && parsed !== null) return finalize(parsed);
        } catch {
          /* try next strategy */
        }
        break;
      }
    }
  }

  // 3. Full text parse
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null) return finalize(parsed);
  } catch {
    /* fall through */
  }

  return {};
}

/**
 * Lightweight structural check of a parsed object against a JSON Schema.
 *
 * Deliberately shallow: it verifies `required` keys are present and that the
 * top-level `type` and each declared property `type` match. It does NOT do
 * full JSON Schema validation (no `$ref`, `oneOf`, formats, nested arrays).
 * The contract here is "flag an obviously non-conforming object" so a mismatch
 * is logged rather than silently accepted; it is not a validation gate.
 *
 * Returns a list of human-readable problems; empty means no detected mismatch.
 */
function schemaMismatches(value: unknown, schema: JSONSchema): string[] {
  const problems: string[] = [];
  const s = schema as Record<string, unknown>;

  if (s.type === "object" || s.properties || s.required) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [`expected an object, got ${Array.isArray(value) ? "array" : typeof value}`];
    }
    const obj = value as Record<string, unknown>;

    const required = Array.isArray(s.required) ? (s.required as string[]) : [];
    for (const key of required) {
      if (!(key in obj) || obj[key] === undefined) {
        problems.push(`missing required property "${key}"`);
      }
    }

    const props = (s.properties as Record<string, unknown>) ?? {};
    for (const [key, propSchema] of Object.entries(props)) {
      if (!(key in obj) || obj[key] === undefined || obj[key] === null) continue;
      const expected = (propSchema as Record<string, unknown>)?.type;
      if (typeof expected === "string" && !jsonTypeMatches(obj[key], expected)) {
        problems.push(`property "${key}" expected ${expected}, got ${jsonTypeOf(obj[key])}`);
      }
    }
  } else if (typeof s.type === "string" && !jsonTypeMatches(value, s.type)) {
    problems.push(`expected ${s.type}, got ${jsonTypeOf(value)}`);
  }

  return problems;
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function jsonTypeMatches(value: unknown, expected: string): boolean {
  switch (expected) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true; // unknown/unsupported type keyword — don't flag
  }
}
