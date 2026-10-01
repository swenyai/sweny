/**
 * pi harness (#415): runs a node on the pi coding agent (bring any model)
 * through `pi --mode rpc`.
 *
 * Interfaces used, all read from badlogic/pi-mono at v0.99.2
 * (`packages/coding-agent`, now also published as earendil-works/pi):
 * - `docs/cli.md`: `--mode rpc`, `--no-session`, `--tools` (allowlist over
 *   built-in, extension and MCP tools), `--exclude-tools`, `--no-tools`,
 *   `--no-extensions` with explicit `-e builtin:mcp`, `--no-context-files`,
 *   `--no-skills`, `--no-prompt-templates`, `--no-themes`, `--no-approve`,
 *   `--model`, `--append-system-prompt`.
 * - `docs/rpc.md`, `docs/rpc-commands.md`: JSONL framing on LF only, the
 *   `prompt`, `abort` and `get_session_stats` commands, `agent_settled`.
 * - `docs/json.md`, `docs/message-types.md`: `message_end` (assistant message
 *   with `stopReason` and `errorMessage`), `tool_execution_start|end`,
 *   `auto_retry_end`.
 * - `docs/mcp.md`, `src/extensions/mcp/`: `mcp.json` in `$PI_CODING_AGENT_DIR`,
 *   `exposure: "direct"` so tools are declared to the model, `${VAR}` in
 *   `env`, tool names `mcp__<server>__<tool>`.
 * - `docs/security.md`: "no built-in sandbox", so the whole process runs
 *   inside the sweny process wrapper (sandbox-wrapper.ts) and strict refuses
 *   without it.
 * - `src/core/agent-session.ts` `_refreshToolRegistry`: a `--tools` allowlist
 *   filters every registered tool, MCP tools included, by exact name.
 *
 * Every sweny opinion in the pi column of the enforcement matrix is enforced
 * natively, kept by sweny (wrapper, tool bridge, prompt + parse + validate,
 * watchdog), reported in `degraded`, or refused under strict policy by
 * `policyGate`. Nothing is dropped silently.
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Logger, McpServerConfig, NodeResult, NodeUsage, ToolCall, ToolContext, Tool } from "../types.js";
import { consoleLogger } from "../types.js";
import {
  PI_AUTH_VARS,
  PI_ENV_PREFIXES,
  finishAgentEnv,
  heldCredentials,
  parseList,
  reportWithheldEnv,
  resolveEnvScope,
  resolvePiProvider,
  resolveSandboxMode,
  scopeAgentEnv,
  withPushBlocked,
  mcpWithheld,
  type AgentAccess,
  type PiProviderResolution,
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
import { PI_CAPABILITIES } from "./capabilities.js";
import { policyGate, resolveHarnessPolicy, type HarnessPolicyMode } from "./policy.js";
import { gitCredentialPolicy } from "../git-credentials.js";
import { buildNodePrompt } from "./prompts.js";
import { makeAbort } from "./abort.js";
import { parseToolResultContent, summarizeToolError, tryParseJSON } from "./parse.js";
import { startToolBridge, type ToolBridge } from "./tool-bridge/server.js";
import {
  defaultSandboxWrapper,
  prepareAgentSpawn,
  wrappersFrom,
  type AgentSpawn,
  type SandboxWrapper,
} from "./sandbox-wrapper.js";
import { TOKEN_ENV } from "./tool-bridge/protocol.js";

export { PI_CAPABILITIES };

/**
 * Oldest pi this adapter is written against. The docs and source were read at
 * v0.99.2; older releases are unverified, so they are refused.
 */
export const MIN_PI_VERSION = "0.99.2";

/** Same system prompt Claude Code nodes get, appended to pi's own. */
const SYSTEM_PROMPT = `You are a step in an automated workflow. Execute the instruction precisely using the tools available to you. Be thorough but concise. When you're done, summarize your findings and results.`;

/** Name of the MCP server that carries sweny's skill tools (the tool bridge). */
export const PI_BRIDGE_SERVER = "sweny-core";

/** pi built-in tools that can write or run code, per portable class (docs/cli.md tools table). */
const BUILTIN_BY_CLASS: Readonly<Partial<Record<ToolClass, readonly string[]>>> = {
  shell: ["bash", "powershell"],
  write: ["write"],
  edit: ["edit"],
};

/** Built-in tools a dry run may keep: they only read. */
const READ_ONLY_BUILTINS = ["read", "grep", "find", "ls"] as const;

/**
 * `disallowed_tools` names a node may use, per portable class. Claude Code
 * names are included because bundled workflows (triage.yml) were written for
 * it; pi names come from its tool table.
 */
const DENY_NAME_TO_CLASSES: Readonly<Record<string, readonly ToolClass[]>> = {
  // Claude Code built-ins
  Bash: ["shell"],
  Write: ["write"],
  NotebookEdit: ["write"],
  Edit: ["edit"],
  MultiEdit: ["edit"],
  WebFetch: ["net"],
  WebSearch: ["net"],
  Task: ["subagent"],
  Agent: ["subagent"],
  // pi built-ins
  bash: ["shell"],
  powershell: ["shell"],
  write: ["write"],
  edit: ["edit"],
};

/** Read-only pi tools a node may still deny by name (`Read` and friends map to them). */
const DENY_NAME_TO_PI_TOOL: Readonly<Record<string, string>> = {
  Read: "read",
  Grep: "grep",
  Glob: "find",
  LS: "ls",
  read: "read",
  grep: "grep",
  find: "find",
  ls: "ls",
};

/** Provider API hosts pi needs through the sandbox wrapper, keyed by the provider's API-key variable. */
const PROVIDER_HOSTS: Readonly<Record<string, string>> = {
  ANTHROPIC_API_KEY: "api.anthropic.com",
  ANTHROPIC_OAUTH_TOKEN: "api.anthropic.com",
  ANTHROPIC_AUTH_TOKEN: "api.anthropic.com",
  OPENAI_API_KEY: "api.openai.com",
  GEMINI_API_KEY: "generativelanguage.googleapis.com",
  OPENROUTER_API_KEY: "openrouter.ai",
  GROQ_API_KEY: "api.groq.com",
  MISTRAL_API_KEY: "api.mistral.ai",
  XAI_API_KEY: "api.x.ai",
  DEEPSEEK_API_KEY: "api.deepseek.com",
};

/** Model provider prefix (`openrouter/...`) to its host, for runs with no provider key in the env. */
const PROVIDER_PREFIX_HOSTS: Readonly<Record<string, string>> = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  google: "generativelanguage.googleapis.com",
  openrouter: "openrouter.ai",
  groq: "api.groq.com",
  mistral: "api.mistral.ai",
  xai: "api.x.ai",
  deepseek: "api.deepseek.com",
};

/**
 * Hosts pi itself needs through the sandbox wrapper: the API host of every
 * provider whose key is in the env, and of the provider named in `--model`
 * (`provider/id`). Other providers (custom endpoints in `models.json`, cloud
 * providers) are added with `SWENY_SANDBOX_ALLOWED_DOMAINS`.
 */
export function piBackendHosts(env: Record<string, string | undefined> = process.env, model?: string): string[] {
  const hosts = new Set<string>();
  for (const [v, host] of Object.entries(PROVIDER_HOSTS)) if (env[v]) hosts.add(host);
  const prefix = model && model.includes("/") ? model.split("/")[0].toLowerCase() : "";
  if (prefix && PROVIDER_PREFIX_HOSTS[prefix]) hosts.add(PROVIDER_PREFIX_HOSTS[prefix]);
  return [...hosts];
}

export interface PiHarnessOptions {
  /** Model passed to `--model`. Free text (`provider/id`, `id:thinking`); sweny has no model opinion. */
  model?: string;
  /**
   * The model provider (`pi_provider`, passed as `--provider`). Only this
   * provider's credential reaches pi. Default: `SWENY_PI_PROVIDER`, else the
   * model's `provider/` prefix, else the one provider whose key is set.
   * Required when several providers' keys are set and the model names none.
   */
  provider?: string;
  /** Tool-call budget the watchdog enforces when a node sets no `max_turns` (default: 20). */
  maxTurns?: number;
  /** Working directory (default: process.cwd()). */
  cwd?: string;
  logger?: Logger;
  /** Default tool context for standalone usage (not via the executor). */
  defaultContext?: ToolContext;
  /** Catalog defaults, overridden by per-run skill servers and explicit mcpServers. */
  defaultMcpServers?: Record<string, McpServerConfig>;
  /** Explicit external MCP servers, overriding defaults and per-run skill servers. */
  mcpServers?: Record<string, McpServerConfig>;
  /** Extra env var names passed through (see agent-env.ts). Default: `SWENY_ENV_PASSTHROUGH`. */
  envPassthrough?: string[];
  /** Scope the pi env to the allowlist. Default: `SWENY_ENV_SCOPE`, else on in CI. */
  envScope?: boolean;
  /**
   * Process sandbox mode (`SWENY_SANDBOX`): `strict` refuses the node without
   * the process wrapper, `auto` wraps when a wrapper is available and otherwise
   * degrades, `off` never wraps. Default: `SWENY_SANDBOX`, else `auto` in CI
   * and `off` locally.
   */
  sandbox?: SandboxMode;
  /**
   * The host's process sandbox wrapper (#360 step 2). `undefined` = detect
   * srt once per process; `null` = none (test seam).
   */
  sandboxWrapper?: SandboxWrapper | null;
  /** `strict` refuses a node with unenforceable opinions. Default: {@link resolveHarnessPolicy}. */
  policy?: HarnessPolicyMode;
  /** The pi CLI. Default: `SWENY_PI_PATH`, else `pi` on PATH. Test seam for the fake. */
  piCommand?: { command: string; args: string[] };
  /**
   * A `models.json` (custom providers and models) copied into pi's scratch
   * agent dir. Default: `SWENY_PI_MODELS_JSON`. Without it pi sees only its
   * built-in model catalog; the operator's own `~/.pi/agent` is never read.
   */
  modelsFile?: string;
  /** Shim command override for the tool bridge (test seam). */
  toolBridgeShim?: { command: string; args: string[] };
  /** How long to wait for pi to stop after the `abort` command before SIGTERM (default: 3000 ms). */
  abortGraceMs?: number;
  /** Grace period between SIGTERM and SIGKILL when stopping pi (default: 2000 ms). */
  killGraceMs?: number;
  /** How long to wait for `get_session_stats` after the run settles (default: 5000 ms). */
  statsTimeoutMs?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * Split `disallowed_tools` names into portable classes pi can act on, pi tools
 * it can exclude by name, and the names it has no tool for.
 */
export function translateDenyNames(names: readonly string[] = []): {
  classes: ToolClass[];
  piTools: string[];
  unknown: string[];
} {
  const classes: ToolClass[] = [];
  const piTools: string[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const mapped = DENY_NAME_TO_CLASSES[n];
    const tool = DENY_NAME_TO_PI_TOOL[n];
    if (mapped) classes.push(...mapped);
    if (tool) piTools.push(tool);
    if (!mapped && !tool) unknown.push(n);
  }
  return { classes: [...new Set(classes)], piTools: [...new Set(piTools)], unknown };
}

/** The name pi registers an MCP tool under (`src/extensions/mcp/tools.ts` createMcpToolName). */
export function piMcpToolName(server: string, tool: string, isTaken: (name: string) => boolean = () => false): string {
  const max = 64;
  const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");
  if (name.length <= max && !isTaken(name)) return name;
  const hash = createHash("sha256").update(`${server}\0${tool}`).digest("hex").slice(0, 8);
  return `${name.slice(0, max - hash.length - 1)}_${hash}`;
}

/** pi registered names of the bridge's tools, and the way back to the sweny names. */
export function bridgeToolNames(tools: readonly Tool[]): { names: string[]; back: Map<string, string> } {
  const taken = new Set<string>();
  const back = new Map<string, string>();
  for (const t of tools) {
    const name = piMcpToolName(PI_BRIDGE_SERVER, t.name, (n) => taken.has(n));
    taken.add(name);
    back.set(name, t.name);
  }
  return { names: [...back.keys()], back };
}

/** Does pi's config syntax treat this value specially (`!command`, `${VAR}`)? Such a value is never written. */
function hasPiConfigSyntax(value: string): boolean {
  return value.startsWith("!") || value.includes("${");
}

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * `mcp.json` entries for the external servers. Returns what pi cannot load
 * (reported in `degraded`). Values using pi's `!command` or `${VAR}` syntax are
 * refused, so a sweny config value can never run a command inside pi.
 */
export function piMcpServers(servers: Record<string, McpServerConfig>): {
  entries: Record<string, Record<string, unknown>>;
  unsupported: string[];
} {
  const entries: Record<string, Record<string, unknown>> = {};
  const unsupported: string[] = [];
  const namespaces = new Map<string, string>([[PI_BRIDGE_SERVER.replace(/-/g, "_"), PI_BRIDGE_SERVER]]);
  for (const [id, s] of Object.entries(servers)) {
    const ns = id.replace(/-/g, "_");
    if (!SERVER_NAME.test(id)) {
      unsupported.push(`${id} (pi server names allow letters, digits, _ and -)`);
      continue;
    }
    if (namespaces.has(ns)) {
      unsupported.push(`${id} (same pi namespace as ${namespaces.get(ns)})`);
      continue;
    }
    const record = (values: Record<string, string> | undefined): boolean =>
      Object.values(values ?? {}).every((v) => !hasPiConfigSyntax(v));
    if (s.type === "http" || (!s.type && s.url && !s.command)) {
      if (!s.url) {
        unsupported.push(`${id} (http without url)`);
        continue;
      }
      if (!record(s.headers)) {
        unsupported.push(`${id} (header value uses pi config syntax)`);
        continue;
      }
      entries[id] = {
        url: s.url,
        ...(s.headers && Object.keys(s.headers).length > 0 ? { headers: s.headers } : {}),
        exposure: "direct",
      };
    } else if (s.command) {
      if (hasPiConfigSyntax(s.command) || !(s.args ?? []).every((a) => !hasPiConfigSyntax(a)) || !record(s.env)) {
        unsupported.push(`${id} (value uses pi config syntax)`);
        continue;
      }
      entries[id] = {
        command: s.command,
        ...(s.args && s.args.length > 0 ? { args: s.args } : {}),
        ...(s.env && Object.keys(s.env).length > 0 ? { env: s.env } : {}),
        exposure: "direct",
      };
    } else {
      unsupported.push(`${id} (type ${String((s as { type?: unknown }).type)})`);
      continue;
    }
    namespaces.set(ns, id);
  }
  return { entries, unsupported };
}

// ─── Process registry (crash cleanup) ────────────────────────────

const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

/**
 * Stop pi. It stays in sweny's process group (not detached), so a Ctrl-C or a
 * CI cancel reaches it too; pi stops its MCP servers itself when it exits.
 */
function stopChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    // already gone
  }
}

function trackChild(child: ChildProcess): void {
  liveChildren.add(child);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // A crashing sweny must not leave pi (and its MCP servers) running.
    process.on("exit", () => {
      for (const c of liveChildren) stopChild(c, "SIGKILL");
    });
  }
}

// ─── One rpc session ─────────────────────────────────────────────

interface RpcOutcome {
  /** `agent_settled` arrived: pi will do nothing more for this prompt. */
  settled: boolean;
  /** The `prompt` command was rejected. */
  promptRejected?: string;
  /** The prompt was consumed as a command; no agent run started. */
  handled?: boolean;
  /** The last assistant message of the run. */
  last?: { text: string; stopReason: string; errorMessage?: string };
  /** Final `auto_retry_end` failure. */
  retryFailure?: string;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  stderrTail: string;
  abortReason?: "timeout" | "signal";
  /** Watchdog stop: tool calls started past the budget. */
  overBudget?: { count: number; limit: number };
  toolCalls: ToolCall[];
  usage?: NodeUsage;
  spawnError?: string;
}

/**
 * `get_session_stats` data onto NodeUsage. pi reports 0 for what a provider did
 * not report (and for a model it has no price for), so only positive values are
 * kept: absent stays absent, never a guessed 0 or a fake free run.
 */
export function mapStats(data: unknown): NodeUsage | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as { tokens?: Record<string, unknown>; cost?: unknown };
  const pos = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  const t = d.tokens ?? {};
  const usage: NodeUsage = {
    costUsd: pos(d.cost),
    inputTokens: pos(t.input),
    outputTokens: pos(t.output),
    cacheReadTokens: pos(t.cacheRead),
    cacheCreationTokens: pos(t.cacheWrite),
  };
  const present = Object.fromEntries(Object.entries(usage).filter(([, v]) => v !== undefined)) as NodeUsage;
  return Object.keys(present).length > 0 ? present : undefined;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: "text"; text: string } => !!b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

// ─── Adapter ─────────────────────────────────────────────────────

export class PiHarness implements AgentHarness {
  readonly id = "pi" as const;
  readonly capabilities: HarnessCapabilities = PI_CAPABILITIES;
  /**
   * Empty on purpose: judges use the model pi would use anyway. Leaving this
   * undefined would fall back to the Claude judge model, which pi may not have.
   */
  readonly defaultJudgeModel = "";
  readonly logger: Logger;
  private model: string | undefined;
  private provider: string | undefined;
  private maxTurns: number;
  private cwd: string;
  private defaultContext: ToolContext;
  private mcpServers: Record<string, McpServerConfig>;
  private defaultMcpServers: Record<string, McpServerConfig>;
  private envPassthrough: string[] | undefined;
  private envScope: boolean | undefined;
  private sandboxMode: SandboxMode | undefined;
  private sandboxWrapper: SandboxWrapper | null | undefined;
  private policyMode: HarnessPolicyMode;
  private piCommand: { command: string; args: string[] };
  private modelsFile: string | undefined;
  private toolBridgeShim: { command: string; args: string[] } | undefined;
  private abortGraceMs: number;
  private killGraceMs: number;
  private statsTimeoutMs: number;
  private egressWarned = false;
  private preflightResult: Promise<{ ok: true; version: string } | { ok: false; reason: string }> | undefined;
  private version = "unknown";

  constructor(opts: PiHarnessOptions = {}) {
    this.model = opts.model;
    this.provider = opts.provider;
    this.maxTurns = opts.maxTurns ?? 20;
    this.cwd = opts.cwd ?? process.cwd();
    this.logger = opts.logger ?? consoleLogger;
    this.defaultContext = opts.defaultContext ?? { config: {}, logger: this.logger };
    this.mcpServers = opts.mcpServers ?? {};
    this.defaultMcpServers = opts.defaultMcpServers ?? {};
    this.envPassthrough = opts.envPassthrough;
    this.envScope = opts.envScope;
    this.sandboxMode = opts.sandbox;
    this.sandboxWrapper = opts.sandboxWrapper;
    this.policyMode = opts.policy ?? resolveHarnessPolicy(process.env, undefined, this.logger);
    this.piCommand = opts.piCommand ?? { command: process.env.SWENY_PI_PATH || "pi", args: [] };
    this.modelsFile = opts.modelsFile ?? (process.env.SWENY_PI_MODELS_JSON || undefined);
    this.toolBridgeShim = opts.toolBridgeShim;
    this.abortGraceMs = opts.abortGraceMs ?? 3000;
    this.killGraceMs = opts.killGraceMs ?? 2000;
    this.statsTimeoutMs = opts.statsTimeoutMs ?? 5000;
  }

  info(): HarnessInfo {
    return { id: this.id, version: this.version };
  }

  /** `pi --version`, checked against {@link MIN_PI_VERSION}. Cached per instance. */
  preflight(): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
    this.preflightResult ??= new Promise((resolve) => {
      const { command, args } = this.piCommand;
      execFile(command, [...args, "--version"], { timeout: 30_000 }, (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          resolve({
            ok: false,
            reason:
              code === "ENOENT"
                ? `pi CLI not found ("${command}"). Install it: npm install -g @earendil-works/pi-coding-agent (>= ${MIN_PI_VERSION}), or set SWENY_PI_PATH`
                : `pi --version failed: ${err.message}`,
          });
          return;
        }
        // pi may print its version on stdout or stderr.
        const m = /(\d+\.\d+\.\d+)/.exec(`${String(stdout)} ${String(stderr)}`);
        if (!m) {
          resolve({ ok: false, reason: `could not read the pi version from "${String(stdout).trim()}"` });
          return;
        }
        if (compareVersions(m[1], MIN_PI_VERSION) < 0) {
          resolve({ ok: false, reason: `pi ${m[1]} is too old; sweny needs >= ${MIN_PI_VERSION}` });
          return;
        }
        this.version = m[1];
        resolve({ ok: true, version: m[1] });
      });
    });
    return this.preflightResult;
  }

  /** Which provider's credential this call gets ({@link resolvePiProvider}). */
  private resolveProvider(model: string | undefined): PiProviderResolution {
    return resolvePiProvider(process.env, model, this.provider);
  }

  /**
   * Env for the pi process: scoped like Claude Code's, with ONE provider's
   * credentials instead of Anthropic's (`providerVars`, from
   * {@link resolvePiProvider}). Every other provider key is dropped, scoped or
   * not, since pi's bash tool inherits this env. Skill credentials are dropped
   * too ({@link finishAgentEnv}) unless the node granted them with `agent_env`.
   */
  private buildEnv(
    access: Pick<AgentAccess, "envVars" | "withhold"> | undefined,
    providerVars: readonly string[],
  ): Record<string, string> {
    const full: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
    );
    const passthrough = this.envPassthrough ?? parseList(process.env.SWENY_ENV_PASSTHROUGH);
    let env = full;
    if (resolveEnvScope(process.env, this.envScope, this.logger)) {
      const scoped = scopeAgentEnv(full, {
        extraVars: access?.envVars ?? [],
        passthrough,
        authVars: providerVars,
        prefixes: PI_ENV_PREFIXES,
        logger: this.logger,
      });
      reportWithheldEnv(scoped.withheld, this.logger);
      env = scoped.env;
    }
    // Other providers' keys never reach pi, even when scoping is off, passed through or granted.
    const otherProviders = PI_AUTH_VARS.filter((v) => !providerVars.includes(v));
    env = Object.fromEntries(Object.entries(env).filter(([k]) => !otherProviders.includes(k)));
    const finished = finishAgentEnv(env, { access, keep: providerVars, passthrough, logger: this.logger }).env;
    // pi must not phone home or look for updates; the agent dir is set per spawn.
    return { ...finished, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" };
  }

  /** The node policy after `disallowed_tools` names are translated into pi classes. */
  private compilePolicy(req: HarnessRunRequest, maxTurns: number): { policy: NodePolicy; piTools: string[] } {
    // A node policy can make the run stricter, never looser than the harness policy mode.
    const base: NodePolicy = req.policy
      ? { ...req.policy, strict: req.policy.strict || this.policyMode === "strict" }
      : {
          readOnly: !!req.readOnly,
          deny: req.deny ?? [],
          nativeDeny: req.disallowedTools,
          egress: req.agentAccess?.domains ?? [],
          strict: this.policyMode === "strict",
        };
    const { classes, piTools, unknown } = translateDenyNames(base.nativeDeny);
    return {
      policy: {
        ...base,
        deny: [...new Set([...base.deny, ...classes])],
        nativeDeny: unknown,
        maxTurns: base.maxTurns ?? maxTurns,
      },
      piTools,
    };
  }

  /** argv shared by run() and complete(); the prompt travels as an RPC command, never in argv. */
  private baseArgs(model: string | undefined, withMcp: boolean, provider?: string): string[] {
    const args = [
      ...this.piCommand.args,
      "--mode",
      "rpc",
      "--no-session",
      // Nothing from the operator's or the project's pi setup: no context files,
      // skills, prompt templates, themes, extensions, or trust-gated project files.
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-approve",
      "--no-extensions",
      "--append-system-prompt",
      SYSTEM_PROMPT,
    ];
    if (withMcp) args.push("-e", "builtin:mcp");
    if (provider) args.push("--provider", provider);
    if (model) args.push("--model", model);
    return args;
  }

  /** Spawn pi in rpc mode, send the prompt, and read events until it settles and exits. */
  private async exec(opts: {
    spawn: AgentSpawn;
    prompt: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    maxToolCalls?: number;
    /** Registered MCP name to the sweny tool name, for the trace. */
    toolNames?: Map<string, string>;
    onProgress?: (message: string) => void;
  }): Promise<RpcOutcome> {
    const out: RpcOutcome = {
      settled: false,
      exitCode: null,
      exitSignal: null,
      stderrTail: "",
      toolCalls: [],
    };
    const byId = new Map<string, ToolCall>();
    let toolCount = 0;
    let stopped = false;
    let statsSent = false;

    const abort = makeAbort(opts.timeoutMs, opts.signal);
    if (abort?.controller.signal.aborted) {
      // Aborted before pi started: nothing to spawn or stop.
      abort.clear();
      out.abortReason = abort.reason();
      return out;
    }
    let child: ChildProcess;
    try {
      child = spawn(opts.spawn.command, opts.spawn.args, {
        cwd: opts.spawn.cwd,
        env: opts.spawn.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      abort?.clear();
      out.spawnError = err instanceof Error ? err.message : String(err);
      return out;
    }
    trackChild(child);

    const closed = new Promise<void>((resolve) => {
      child.once("close", (code, signal) => {
        out.exitCode = code;
        out.exitSignal = signal;
        resolve();
      });
      child.once("error", (err) => {
        out.spawnError = err.message;
        resolve();
      });
    });

    child.stdin?.on("error", () => {
      // pi exited before reading a command; the exit code tells the story.
    });
    const send = (command: Record<string, unknown>) => {
      if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded) return;
      child.stdin.write(JSON.stringify(command) + "\n");
    };

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    let statsTimer: ReturnType<typeof setTimeout> | undefined;
    /** Close stdin (pi's orderly shutdown), then SIGTERM and SIGKILL if it lingers. */
    const hardStop = () => {
      try {
        child.stdin?.end();
      } catch {
        // already closed
      }
      stopChild(child, "SIGTERM");
      killTimer ??= setTimeout(() => stopChild(child, "SIGKILL"), this.killGraceMs);
      killTimer.unref?.();
    };
    /** Ask pi to stop with the `abort` command; kill it if it does not settle in time. */
    const stop = () => {
      if (stopped) return;
      stopped = true;
      send({ type: "abort" });
      if (abortTimer) clearTimeout(abortTimer);
      abortTimer = setTimeout(hardStop, this.abortGraceMs);
      abortTimer.unref?.();
    };
    /** Orderly end: stdin closes and pi exits by itself. */
    const finish = () => {
      try {
        child.stdin?.end();
      } catch {
        // already closed
      }
      // A pi that does not exit after stdin closes is stopped like a hung one.
      abortTimer ??= setTimeout(hardStop, this.abortGraceMs);
      abortTimer.unref?.();
    };
    if (abort) {
      const onAbort = () => {
        out.abortReason = abort.reason();
        stop();
      };
      abort.controller.signal.addEventListener("abort", onAbort, { once: true });
      if (abort.controller.signal.aborted) onAbort();
    }

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.logger.debug(`[pi] ${chunk.trimEnd()}`);
      out.stderrTail = (out.stderrTail + chunk).slice(-2000);
    });

    const PROMPT_ID = "sweny-prompt";
    const STATS_ID = "sweny-stats";

    const onToolStart = (ev: Record<string, any>) => {
      const id = String(ev.toolCallId ?? "");
      const raw = String(ev.toolName ?? "");
      const tool = opts.toolNames?.get(raw) ?? raw.replace(/^mcp__sweny_core__/, "");
      const call: ToolCall = { tool, input: ev.args };
      out.toolCalls.push(call);
      if (id) byId.set(id, call);
      toolCount++;
      opts.onProgress?.(tool.length > 80 ? tool.slice(0, 79) + "…" : tool);
      if (opts.maxToolCalls !== undefined && toolCount > opts.maxToolCalls && !out.overBudget) {
        out.overBudget = { count: toolCount, limit: opts.maxToolCalls };
        stop();
      }
    };

    const onToolEnd = (ev: Record<string, any>) => {
      const call = byId.get(String(ev.toolCallId ?? ""));
      if (!call || call.status !== undefined) return;
      const content = ev.result?.content;
      if (ev.isError === true) {
        const detail = parseToolResultContent(content ?? "");
        call.status = "error";
        call.output = { error: detail };
        this.logger.warn(`  tool ${call.tool} failed: ${summarizeToolError(detail)}`);
      } else {
        call.status = "success";
        call.output = content === undefined ? null : parseToolResultContent(content);
      }
    };

    const onLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: Record<string, any>;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        this.logger.debug(`[pi] non-JSON stdout line ignored`);
        return;
      }
      switch (ev.type) {
        case "response":
          if (ev.id === PROMPT_ID) {
            if (ev.success !== true) {
              out.promptRejected = String(ev.error ?? "prompt rejected");
              finish();
            } else if (ev.data?.disposition === "handled") {
              // An extension or input handler consumed the prompt: no agent run will follow.
              out.handled = true;
              finish();
            }
          } else if (ev.id === STATS_ID) {
            if (ev.success === true) out.usage = mapStats(ev.data);
            else this.logger.debug(`[pi] get_session_stats failed: ${String(ev.error ?? "")}`);
            if (statsTimer) clearTimeout(statsTimer);
            finish();
          }
          break;
        case "tool_execution_start":
          onToolStart(ev);
          break;
        case "tool_execution_end":
          onToolEnd(ev);
          break;
        case "message_end":
          if (ev.message?.role === "assistant") {
            out.last = {
              text: textOf(ev.message.content),
              stopReason: String(ev.message.stopReason ?? ""),
              ...(typeof ev.message.errorMessage === "string" ? { errorMessage: ev.message.errorMessage } : {}),
            };
          }
          break;
        case "auto_retry_end":
          if (ev.success === false) out.retryFailure = String(ev.finalError ?? "retries exhausted");
          break;
        case "extension_error":
          this.logger.warn(`  pi extension error: ${String(ev.error ?? "")}`);
          break;
        case "agent_settled":
          out.settled = true;
          if (stopped) {
            // Aborted or over budget: nothing more to read.
            finish();
          } else if (!statsSent) {
            statsSent = true;
            send({ id: STATS_ID, type: "get_session_stats" });
            statsTimer = setTimeout(finish, this.statsTimeoutMs);
            statsTimer.unref?.();
          }
          break;
        default:
          break;
      }
    };

    // Strict JSONL: split on LF only (docs/rpc.md), never on Unicode line separators.
    let buf = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        onLine(line);
      }
    });

    send({ id: PROMPT_ID, type: "prompt", message: opts.prompt });

    await closed;
    // A final line without a newline is complete only if it parses.
    if (buf.trim()) onLine(buf);
    for (const t of [killTimer, abortTimer, statsTimer]) if (t) clearTimeout(t);
    abort?.clear();
    liveChildren.delete(child);
    return out;
  }

  /** Write pi's scratch agent dir: generated `mcp.json` only (plus an operator-supplied `models.json`). */
  private writeAgentDir(dir: string, mcp?: Record<string, Record<string, unknown>>): void {
    if (mcp && Object.keys(mcp).length > 0) {
      // `autoEnableCodemode: false`: tools are declared directly, never behind a script tool.
      const doc = { mcpServers: mcp, autoEnableCodemode: false };
      fs.writeFileSync(path.join(dir, "mcp.json"), JSON.stringify(doc, null, 2), { mode: 0o600 });
    }
    if (this.modelsFile) {
      try {
        fs.copyFileSync(this.modelsFile, path.join(dir, "models.json"));
        fs.chmodSync(path.join(dir, "models.json"), 0o600);
      } catch (err) {
        this.logger.warn(`  pi: could not copy models.json from ${this.modelsFile}: ${String(err)}`);
      }
    }
  }

  /**
   * Run a node. The gate runs first: in strict mode a node whose opinions pi
   * cannot honor is refused before pi starts. pi has no native sandbox, so the
   * whole process runs inside the host's process sandbox wrapper (#360 step 2)
   * when the sandbox mode is not off; `SWENY_SANDBOX=strict` refuses without one.
   */
  async run(req: HarnessRunRequest): Promise<HarnessRunResult> {
    const maxTurns = req.maxTurns ?? this.maxTurns;
    const mode: SandboxMode = req.policy?.sandbox ?? resolveSandboxMode(process.env, this.sandboxMode, this.logger);
    const compiled = this.compilePolicy(req, maxTurns);
    const model = req.model ?? this.model;
    const provider = this.resolveProvider(model);
    const env = withPushBlocked(this.buildEnv(req.agentAccess, provider.vars), req.agentAccess?.noPush);
    const held = heldCredentials(env, req.agentAccess?.withhold);
    const policy: NodePolicy = {
      ...compiled.policy,
      sandbox: mode,
      ...(held.length > 0 ? { agentCredentials: held } : {}),
      ...(req.agentAccess?.noPush && !compiled.policy.readOnly ? { stagedWrite: true } : {}),
      // #473: a credential the checkout persisted stays unreadable to read-only and staged nodes.
      ...gitCredentialPolicy(this.cwd, { readOnly: compiled.policy.readOnly, noPush: req.agentAccess?.noPush }),
    };
    const needsWrapper = mode !== "off";
    const wrapper =
      needsWrapper && this.sandboxWrapper !== null
        ? (this.sandboxWrapper ?? (await defaultSandboxWrapper()).wrapper)
        : undefined;
    const gate = policyGate(this.capabilities, policy, wrappersFrom(wrapper));
    let degraded = gate.degraded;
    const extraDegraded: string[] = [];
    const tag = (r: NodeResult): HarnessRunResult => ({
      ...r,
      // Only the process wrapper keeps the agent out of the sweny state dir.
      contained: wrapper !== undefined,
      harness: this.info(),
      degraded: [...degraded, ...extraDegraded],
    });
    const refused = (why: string): HarnessRunResult => {
      const msg = `pi refused this node: ${why}`;
      this.logger.error(msg);
      // `refused` keeps fail_soft from softening a policy refusal (executor.ts).
      return tag({ status: "failed", data: { error: msg, refused: true }, toolCalls: [] });
    };

    if (gate.refuse) return refused(gate.refuse);
    if (provider.error) {
      this.logger.error(provider.error);
      return tag({ status: "failed", data: { error: provider.error }, toolCalls: [] });
    }

    const pre = await this.preflight();
    if (!pre.ok) {
      this.logger.error(pre.reason);
      return tag({ status: "failed", data: { error: pre.reason }, toolCalls: [] });
    }

    const readOnly = policy.readOnly;
    const deny = new Set<ToolClass>(policy.deny);
    if (readOnly) for (const c of ["shell", "write", "edit"] as ToolClass[]) deny.add(c);

    let bridge: ToolBridge | undefined;
    let agentDir: string | undefined;
    let prepCleanup: (() => Promise<void>) | undefined;

    try {
      // Dry run: external MCP servers cannot be classified per tool (and a
      // `--tools` allowlist cannot name tools it has not seen), so only sweny's
      // own (already read-filtered) skill tools remain.
      const servers: Record<string, McpServerConfig> = mcpWithheld(readOnly, req.agentAccess)
        ? {}
        : { ...this.defaultMcpServers, ...req.mcpServers, ...this.mcpServers };
      const { entries, unsupported } = piMcpServers(servers);
      if (unsupported.length > 0) {
        const note = `mcp: pi cannot load ${unsupported.join(", ")}`;
        this.logger.warn(`  ${note}`);
        extraDegraded.push(note);
      }
      let toolNames: Map<string, string> | undefined;
      let bridgeNames: string[] = [];
      if (req.tools.length > 0) {
        bridge = await startToolBridge({
          tools: req.tools,
          context: this.defaultContext,
          logger: this.logger,
          // Wrapped, the shim cannot open the unix socket (srt blocks AF_UNIX on
          // Linux); it tunnels to a loopback port through the sandbox proxy (#439).
          tcp: wrapper !== undefined,
          ...(this.toolBridgeShim ? { shimCommand: this.toolBridgeShim } : {}),
        });
        const shim = bridge.mcpServer;
        // The token reaches the shim by reference (`${VAR}`), never in a file or argv.
        env[TOKEN_ENV] = bridge.token;
        const ref = (name: string) => "${" + name + "}";
        entries[PI_BRIDGE_SERVER] = {
          command: shim.command,
          args: shim.args ?? [],
          env: {
            SWENY_NO_UPDATE_CHECK: "1",
            [TOKEN_ENV]: ref(TOKEN_ENV),
            // The proxy srt sets for pi, which pi's MCP client does not pass on by itself.
            ...(bridge.tcp ? { HTTP_PROXY: ref("HTTP_PROXY"), http_proxy: ref("http_proxy") } : {}),
          },
          exposure: "direct",
          timeout: 600,
        };
        const named = bridgeToolNames(req.tools);
        toolNames = named.back;
        bridgeNames = named.names;
      }

      // Tool selection. A dry run is an allowlist (only reading tools plus
      // sweny's own); otherwise built-ins are denied by name and MCP tools stay.
      const toolArgs: string[] = [];
      const excluded = new Set<string>(compiled.piTools);
      for (const c of deny) for (const n of BUILTIN_BY_CLASS[c] ?? []) excluded.add(n);
      if (readOnly) {
        const allow = [...READ_ONLY_BUILTINS.filter((n) => !excluded.has(n)), ...bridgeNames];
        toolArgs.push(...(allow.length > 0 ? ["--tools", allow.join(",")] : ["--no-tools"]));
      } else if (excluded.size > 0) {
        toolArgs.push("--exclude-tools", [...excluded].join(","));
      }

      const args = [
        ...this.baseArgs(model, Object.keys(entries).length > 0, provider.explicit ? provider.provider : undefined),
        ...toolArgs,
      ];
      // Only the selected provider's host: its key is the only one pi holds.
      const backendHosts = piBackendHosts(env, model);
      // The bridge's loopback endpoint (wrapped runs only): the one extra host the shim needs.
      const harnessEgress = [...backendHosts, ...(bridge?.egress ?? [])];
      if (mode !== "off" && backendHosts.length === 0 && !this.egressWarned) {
        this.egressWarned = true;
        this.logger.warn(
          "pi runs inside the sandbox wrapper with no known model API host; add it with SWENY_SANDBOX_ALLOWED_DOMAINS.",
        );
      }
      const prep = await prepareAgentSpawn({
        caps: this.capabilities,
        policy,
        spawn: { command: this.piCommand.command, args, env, cwd: this.cwd },
        wrapper: wrapper ?? null,
        harnessEgress,
        env: process.env,
      });
      prepCleanup = prep.cleanup;
      degraded = prep.degraded;
      if (prep.refuse) return refused(prep.refuse);

      // pi's agent dir must be writable (it writes logs and caches there), so
      // under the wrapper it lives in the wrapper's scratch HOME.
      agentDir = prep.home
        ? path.join(prep.home, `.sweny-pi-${randomBytes(4).toString("hex")}`)
        : fs.mkdtempSync(path.join(os.tmpdir(), "sweny-pi-"));
      fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
      this.writeAgentDir(agentDir, entries);

      const out = await this.exec({
        spawn: { ...prep.spawn, env: { ...prep.spawn.env, PI_CODING_AGENT_DIR: agentDir } },
        prompt: buildNodePrompt(req.instruction, req.context, req.outputSchema),
        timeoutMs: req.timeoutMs,
        signal: req.signal,
        maxToolCalls: maxTurns,
        toolNames,
        onProgress: req.onProgress,
      });
      return tag(this.toResult(out, req.outputSchema, req.timeoutMs));
    } catch (err) {
      const msg = `pi run failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(msg);
      return tag({ status: "failed", data: { error: msg }, toolCalls: [] });
    } finally {
      await bridge?.close();
      if (agentDir) fs.rmSync(agentDir, { recursive: true, force: true });
      await prepCleanup?.();
    }
  }

  /** Map one rpc outcome onto a NodeResult with Claude Code's semantics. */
  private toResult(out: RpcOutcome, outputSchema: NodeSchema, timeoutMs?: number): NodeResult {
    const { toolCalls, usage } = out;
    const withUsage = (r: NodeResult): NodeResult => (usage ? { ...r, usage } : r);
    const last = out.last?.text ?? "";
    const fail = (error: string, partial = false): NodeResult => {
      this.logger.error(error);
      return withUsage({
        status: "failed",
        data: { error, ...(partial && last.trim() !== "" ? { summary: last.trim() } : {}) },
        toolCalls,
      });
    };

    if (out.spawnError) return fail(`pi could not start: ${out.spawnError}`);
    if (out.abortReason === "timeout") return fail(`pi run timed out after ${timeoutMs}ms`);
    if (out.abortReason === "signal") return fail("pi run aborted");
    if (out.overBudget) {
      // Same shape as Claude Code's max_turns stop: partial text is kept for fail_soft nodes.
      return fail(
        `pi run terminated early: max_turns (${out.overBudget.limit} tool calls; stopped by the sweny watchdog)`,
        true,
      );
    }
    if (out.promptRejected) return fail(`pi rejected the prompt: ${out.promptRejected}`);
    if (out.handled) return fail("pi handled the prompt as a command and ran no agent turn");
    if (!out.settled) {
      const code = out.exitSignal ? `signal ${out.exitSignal}` : `code ${out.exitCode}`;
      const tail = out.stderrTail.trim().split("\n").slice(-3).join(" | ");
      return fail(
        out.exitCode === 0 && !out.exitSignal
          ? `agent stream ended without a result message (${toolCalls.length} tool calls captured)`
          : `pi exited with ${code}${tail ? `: ${tail}` : ""}`,
        true,
      );
    }
    const l = out.last;
    if (!l) return fail("pi settled without an assistant message");
    if (l.stopReason !== "stop") {
      const why = l.errorMessage ?? out.retryFailure;
      if (l.stopReason === "aborted") return fail("pi run aborted", true);
      if (l.stopReason === "length") return fail("pi run stopped at the model's output limit", true);
      return fail(`pi run failed (${l.stopReason || "no stop reason"})${why ? `: ${why}` : ""}`, true);
    }
    if (out.exitCode !== 0 || out.exitSignal) {
      const code = out.exitSignal ? `signal ${out.exitSignal}` : `code ${out.exitCode}`;
      return fail(`pi exited with ${code} after completing the run`);
    }

    const parsed = tryParseJSON(last, outputSchema, this.logger, "pi");
    return withUsage({ status: "success", data: { summary: last, ...parsed }, toolCalls });
  }

  /**
   * One completion: no tools (`--no-tools`), no MCP, no extensions, an empty
   * scratch agent dir. Nothing can act, so no process wrapper is needed.
   * null when it failed (callers fail closed).
   */
  async complete(req: HarnessCompleteRequest): Promise<string | null> {
    const purpose = req.purpose ?? "ask";
    const failClosed = (why: string): null => {
      this.logger.warn(
        purpose === "evaluate"
          ? `pi.evaluate: ${why}. Failing closed (no route decision).`
          : `pi.ask: ${why}. Returning empty string.`,
      );
      return null;
    };
    const pre = await this.preflight();
    if (!pre.ok) return failClosed(pre.reason);

    // An empty model (the judge default) means pi's own default model.
    const model = req.model || this.model;
    const provider = this.resolveProvider(model);
    if (provider.error) return failClosed(provider.error);

    let agentDir: string | undefined;
    try {
      agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-pi-"));
      this.writeAgentDir(agentDir);
      const env = { ...this.buildEnv(undefined, provider.vars), PI_CODING_AGENT_DIR: agentDir };
      const out = await this.exec({
        spawn: {
          command: this.piCommand.command,
          args: [...this.baseArgs(model, false, provider.explicit ? provider.provider : undefined), "--no-tools"],
          env,
          cwd: this.cwd,
        },
        prompt: req.prompt,
        timeoutMs: req.timeoutMs,
        signal: req.signal,
        // Classification calls use no tools; any tool call is over budget.
        maxToolCalls: 0,
      });
      if (out.spawnError) return failClosed(`pi could not start: ${out.spawnError}`);
      if (out.abortReason === "timeout") return failClosed(`timed out after ${req.timeoutMs}ms`);
      if (out.abortReason === "signal") return failClosed("aborted");
      if (out.overBudget) return failClosed("the model tried to call a tool");
      if (out.promptRejected || out.handled)
        return failClosed(out.promptRejected ?? "the prompt was handled as a command");
      if (!out.settled) return failClosed(`agent stream ended without a result message (pi exit ${out.exitCode})`);
      if (out.last?.stopReason !== "stop") {
        return failClosed(
          `pi run failed (${out.last?.stopReason || "no assistant message"})${out.last?.errorMessage ? `: ${out.last.errorMessage}` : ""}`,
        );
      }
      if (out.exitCode !== 0 || out.exitSignal) return failClosed(`pi exited with code ${out.exitCode}`);
      return out.last.text;
    } catch (err) {
      return failClosed(err instanceof Error ? err.message : String(err));
    } finally {
      if (agentDir) fs.rmSync(agentDir, { recursive: true, force: true });
    }
  }
}

type NodeSchema = HarnessRunRequest["outputSchema"];
