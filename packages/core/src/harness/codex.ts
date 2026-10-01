/**
 * Codex harness (#331): runs a node on OpenAI Codex through `codex exec --json`.
 *
 * Interfaces used, all read from openai/codex at rust-v0.159.2:
 * - `codex-rs/exec/src/cli.rs`: `exec --json`, `--output-schema <file>`,
 *   `--ignore-user-config`, `--ignore-rules`, `--ephemeral`,
 *   `--skip-git-repo-check`, `--sandbox`, `--cd`, `--model`, `-c key=value`,
 *   prompt on stdin with `-`.
 * - `codex-rs/exec/src/exec_events.rs`: the JSONL events (`thread.started`,
 *   `turn.started|completed|failed`, `item.started|updated|completed`,
 *   `error`) and item kinds.
 * - `sdk/typescript/src/exec.ts`: how the official SDK spawns the same CLI
 *   (config overrides as TOML values, stdin prompt, exit handling).
 * - `codex-rs/core/config.schema.json`: `features.*`, `web_search`,
 *   `agents.enabled`, `sandbox_workspace_write.network_access`,
 *   `mcp_servers.<id>.{command,args,env,env_vars,url,http_headers,...}`.
 * - `codex-rs/rmcp-client/src/utils.rs`: an MCP stdio server gets only a
 *   small default env plus the names listed in `env_vars`, so the tool
 *   bridge token travels by name, never in argv.
 *
 * Every sweny opinion in the Codex column of the enforcement matrix is
 * enforced natively here, kept by sweny (watchdog, fencing, env scoping,
 * output parsing), reported in `degraded`, or refused under strict policy
 * by `policyGate`. Nothing is dropped silently.
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { JSONSchema, Logger, McpServerConfig, NodeResult, NodeUsage, ToolCall, ToolContext } from "../types.js";
import { consoleLogger } from "../types.js";
import {
  CODEX_AUTH_VARS,
  CODEX_ENV_PREFIXES,
  checkSandboxSupport,
  finishAgentEnv,
  heldCredentials,
  parseList,
  reportWithheldEnv,
  resolveCodexAuthEnv,
  resolveEnvScope,
  resolveSandboxMode,
  scopeAgentEnv,
  withPushBlocked,
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
import { CODEX_CAPABILITIES } from "./capabilities.js";
import { policyGate, resolveHarnessPolicy, type HarnessPolicyMode } from "./policy.js";
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
import { codexAuth, type AuthProbe } from "./auth.js";

export { CODEX_CAPABILITIES };

/** Oldest Codex CLI whose flags this adapter uses (`--ignore-user-config`, `--ignore-rules`). */
export const MIN_CODEX_VERSION = "0.159.0";

/**
 * The Codex CLI the capability claims in capabilities.ts were read from and the contract suite
 * was written against (openai/codex rust-v0.159.2). action.yml installs this version by default.
 * A newer CLI is not refused (it is only a warning, see `preflight`): the claims are about a
 * version, not a range, so a newer one is unverified rather than known-bad.
 */
export const TESTED_CODEX_VERSION = "0.159.2";

/** Same system prompt Claude Code nodes get, sent as Codex developer instructions. */
const SYSTEM_PROMPT = `You are a step in an automated workflow. Execute the instruction precisely using the tools available to you. Be thorough but concise. When you're done, summarize your findings and results.`;

/**
 * Codex features sweny always turns off, so a node sees only the tools sweny
 * gave it: ChatGPT apps and plugins (their own MCP servers), tool suggestions,
 * browser and computer use, lifecycle hooks, and image generation. Keys from
 * `codex-rs/features/src/lib.rs` at rust-v0.159.2.
 */
export const CODEX_ISOLATION_FEATURES_OFF = [
  "apps",
  "plugins",
  "tool_suggest",
  "browser_use",
  "computer_use",
  "hooks",
  "image_generation",
] as const;

/**
 * Built-in tool names a node's `disallowed_tools` may use, per portable class.
 * Claude Code names are included because bundled workflows (triage.yml) were
 * written for it; Codex names come from its tool registry.
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
  // Codex built-ins
  shell: ["shell"],
  exec_command: ["shell"],
  local_shell: ["shell"],
  apply_patch: ["write", "edit"],
  web_search: ["net"],
  spawn_agent: ["subagent"],
};

/**
 * Hosts Codex itself needs (its model API and ChatGPT sign-in), always allowed
 * through the sandbox wrapper, plus the host of `OPENAI_BASE_URL` when set.
 */
export function codexBackendHosts(env: Record<string, string | undefined> = process.env): string[] {
  const hosts = ["api.openai.com", "chatgpt.com", "auth.openai.com"];
  if (env.OPENAI_BASE_URL) {
    try {
      hosts.push(new URL(env.OPENAI_BASE_URL).host);
    } catch {
      // not a URL: nothing to add
    }
  }
  return hosts;
}

/** Codex item kinds that are tool calls; the turn watchdog counts these. */
const TOOL_ITEM_KINDS = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
  "collab_tool_call",
]);

export interface CodexHarnessOptions {
  /** Model override (`--model`). Free text; sweny has no model opinion. */
  model?: string;
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
  /** Scope the Codex env to the allowlist. Default: `SWENY_ENV_SCOPE`, else on in CI. */
  envScope?: boolean;
  /**
   * Codex sandbox for commands: `strict` = `workspace-write` or fail, `auto` =
   * `workspace-write` when the host can sandbox, `off` = `danger-full-access`.
   * Default: `SWENY_SANDBOX`, else `auto` in CI and `off` locally.
   */
  sandbox?: SandboxMode;
  /** Sandbox preflight probe (test seam). Returns a reason when the host cannot sandbox. */
  sandboxProbe?: () => string | undefined;
  /**
   * The host's process sandbox wrapper (#360 step 2). `undefined` = detect
   * srt once per process; `null` = none (test seam).
   */
  sandboxWrapper?: SandboxWrapper | null;
  /** `strict` refuses a node with unenforceable opinions. Default: {@link resolveHarnessPolicy}. */
  policy?: HarnessPolicyMode;
  /** The Codex CLI. Default: `SWENY_CODEX_PATH`, else `codex` on PATH. Test seam for the fake. */
  codexCommand?: { command: string; args: string[] };
  /** Shim command override for the tool bridge (test seam). */
  toolBridgeShim?: { command: string; args: string[] };
  /** Grace period between SIGTERM and SIGKILL when stopping Codex (default: 2000 ms). */
  killGraceMs?: number;
  /** Login probe for `preflight()` (test seam). Default: {@link codexAuth} over `process.env`. */
  authProbe?: AuthProbe;
}

// ─── Helpers ─────────────────────────────────────────────────────

/** A TOML value for `-c key=value`, as the official SDK writes it (sdk/typescript/src/exec.ts). */
export function toTomlValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("codex config: numbers must be finite");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(toTomlValue).join(", ")}]`;
  if (value && typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k)} = ${toTomlValue(v)}`);
    return `{${parts.join(", ")}}`;
  }
  throw new Error(`codex config: unsupported value ${String(value)}`);
}

/** A dotted config key segment, quoted when it is not a bare TOML key. */
function keySegment(k: string): string {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k);
}

function cfg(key: string, value: unknown): string[] {
  return ["-c", `${key}=${toTomlValue(value)}`];
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * Split `disallowed_tools` names into portable classes Codex can act on and
 * the names it has no tool for.
 */
export function translateDenyNames(names: readonly string[] = []): { classes: ToolClass[]; unknown: string[] } {
  const classes: ToolClass[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const mapped = DENY_NAME_TO_CLASSES[n];
    if (mapped) classes.push(...mapped);
    else unknown.push(n);
  }
  return { classes: [...new Set(classes)], unknown };
}

/**
 * Is this JSON schema accepted by OpenAI strict structured outputs? Codex
 * sends `--output-schema` with `strict: true` (core/src/session/turn.rs), which
 * requires `additionalProperties: false` and every property listed in
 * `required` on every object. Not a full check; it catches the common misses.
 */
export function isStrictCompatibleSchema(schema: unknown): boolean {
  const visit = (s: unknown): boolean => {
    if (!s || typeof s !== "object") return true;
    const o = s as Record<string, unknown>;
    const props = o.properties as Record<string, unknown> | undefined;
    if (o.type === "object" || props) {
      if (o.additionalProperties !== false) return false;
      const req = Array.isArray(o.required) ? (o.required as string[]) : [];
      for (const k of Object.keys(props ?? {})) if (!req.includes(k)) return false;
      for (const v of Object.values(props ?? {})) if (!visit(v)) return false;
    }
    if (o.items && !visit(o.items)) return false;
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const list = o[key];
      if (Array.isArray(list) && !list.every(visit)) return false;
    }
    for (const key of ["$defs", "definitions"]) {
      const defs = o[key] as Record<string, unknown> | undefined;
      if (defs && !Object.values(defs).every(visit)) return false;
    }
    return true;
  };
  return visit(schema);
}

// ─── Process registry (crash cleanup) ────────────────────────────

const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

/** Stop the owned process tree, even after its leader has exited. */
function stopChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform !== "win32") {
      // exec() gives each run its own process group. Descendants can retain
      // stdout/stderr after the leader exits, so do not gate this on exitCode.
      process.kill(-child.pid, signal);
    } else {
      // Windows has no POSIX process groups. Bound the tree-kill utility too.
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { timeout: 1000 }, () => {});
      child.kill(signal);
    }
  } catch {
    // already gone
  }
}

function trackChild(child: ChildProcess): void {
  liveChildren.add(child);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // A crashing sweny must not leave Codex (and its MCP servers) running.
    const cleanup = () => {
      for (const c of liveChildren) stopChild(c, "SIGKILL");
    };
    process.on("exit", cleanup);
    // Detached POSIX groups no longer receive our terminal's signals. Clean
    // them up before host once-handlers remove themselves during dispatch.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const onSignal = () => {
        cleanup();
        if (process.listenerCount(signal) === 1) {
          process.removeListener(signal, onSignal);
          process.kill(process.pid, signal);
        }
      };
      process.prependListener(signal, onSignal);
    }
  }
}

// ─── Run one codex exec ──────────────────────────────────────────

interface ExecOutcome {
  /** A `turn.completed` event arrived. */
  completed: boolean;
  /** `turn.failed` message. */
  failure?: string;
  /** Last `error` event; the failure reason when no turn.completed arrives. */
  lastError?: string;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  stderrTail: string;
  abortReason?: "timeout" | "signal";
  /** Watchdog stop: tool calls started past the budget. */
  overBudget?: { count: number; limit: number };
  /** Text of every completed agent message, in order. */
  messages: string[];
  toolCalls: ToolCall[];
  usage?: NodeUsage;
  spawnError?: string;
}

function mapUsage(u: unknown): NodeUsage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const m = u as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const usage: NodeUsage = {
    inputTokens: num(m.input_tokens),
    outputTokens: num(m.output_tokens),
    cacheReadTokens: num(m.cached_input_tokens),
    cacheCreationTokens: num(m.cache_write_input_tokens),
  };
  const present = Object.fromEntries(Object.entries(usage).filter(([, v]) => v !== undefined)) as NodeUsage;
  return Object.keys(present).length > 0 ? present : undefined;
}

// ─── Adapter ─────────────────────────────────────────────────────

export class CodexHarness implements AgentHarness {
  readonly id = "codex" as const;
  readonly capabilities: HarnessCapabilities = CODEX_CAPABILITIES;
  /**
   * Empty on purpose: judges use Codex's own default model. Leaving this
   * undefined would fall back to the Claude judge model, which Codex cannot run.
   */
  readonly defaultJudgeModel = "";
  readonly logger: Logger;
  private model: string | undefined;
  private maxTurns: number;
  private cwd: string;
  private defaultContext: ToolContext;
  private mcpServers: Record<string, McpServerConfig>;
  private defaultMcpServers: Record<string, McpServerConfig>;
  private envPassthrough: string[] | undefined;
  private envScope: boolean | undefined;
  private sandboxMode: SandboxMode | undefined;
  private sandboxProbe: (() => string | undefined) | undefined;
  private sandboxWarned = false;
  private sandboxWrapper: SandboxWrapper | null | undefined;
  private loginWarned = false;
  private policyMode: HarnessPolicyMode;
  private codexCommand: { command: string; args: string[] };
  private toolBridgeShim: { command: string; args: string[] } | undefined;
  private killGraceMs: number;
  private preflightResult: Promise<{ ok: true; version: string } | { ok: false; reason: string }> | undefined;
  private version = "unknown";
  private authProbe: AuthProbe;

  constructor(opts: CodexHarnessOptions = {}) {
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
    this.sandboxProbe = opts.sandboxProbe;
    this.sandboxWrapper = opts.sandboxWrapper;
    this.policyMode = opts.policy ?? resolveHarnessPolicy(process.env, undefined, this.logger);
    this.codexCommand = opts.codexCommand ?? { command: process.env.SWENY_CODEX_PATH || "codex", args: [] };
    this.toolBridgeShim = opts.toolBridgeShim;
    this.killGraceMs = opts.killGraceMs ?? 2000;
    this.authProbe = opts.authProbe ?? (() => codexAuth(process.env));
  }

  info(): HarnessInfo {
    return { id: this.id, version: this.version };
  }

  /**
   * Before any node runs (#339): the Codex CLI is installed and new enough,
   * and Codex can authenticate (an API key, an access token, or `codex login`).
   */
  async preflight(): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
    const cli = await this.checkCli();
    if (!cli.ok) return cli;
    const auth = this.authProbe();
    return auth.ok ? cli : { ok: false, reason: auth.reason };
  }

  /** `codex --version`, checked against {@link MIN_CODEX_VERSION}. Cached per instance. */
  private checkCli(): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
    this.preflightResult ??= new Promise((resolve) => {
      const { command, args } = this.codexCommand;
      execFile(command, [...args, "--version"], { timeout: 30_000 }, (err, stdout) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          resolve({
            ok: false,
            reason:
              code === "ENOENT"
                ? `codex CLI not found ("${command}"). Install it: npm install -g @openai/codex (>= ${MIN_CODEX_VERSION})`
                : `codex --version failed: ${err.message}`,
          });
          return;
        }
        const m = /(\d+\.\d+\.\d+)/.exec(String(stdout));
        if (!m) {
          resolve({ ok: false, reason: `could not read the codex version from "${String(stdout).trim()}"` });
          return;
        }
        if (compareVersions(m[1], MIN_CODEX_VERSION) < 0) {
          resolve({ ok: false, reason: `codex ${m[1]} is too old; sweny needs >= ${MIN_CODEX_VERSION}` });
          return;
        }
        this.version = m[1];
        // Newer than the tested version: the declared capabilities may no longer hold. Warn once
        // (the result is cached per instance). Not `degraded`: that is a per-node policy report and
        // there is no node yet; not a refusal: it would break anyone who chose `latest` on purpose.
        if (compareVersions(m[1], TESTED_CODEX_VERSION) > 0) {
          this.logger.warn(
            `codex ${m[1]} is newer than ${TESTED_CODEX_VERSION}, the version sweny's Codex capabilities were tested against; ` +
              `flags and event shapes may differ. Pin @openai/codex@${TESTED_CODEX_VERSION} (action input codex-version) for the tested behavior.`,
          );
        }
        resolve({ ok: true, version: m[1] });
      });
    });
    return this.preflightResult;
  }

  /**
   * Env for the Codex process: scoped like Claude Code's, with Codex's auth
   * vars instead of Anthropic's. Skill credentials are dropped either way
   * ({@link finishAgentEnv}) unless the node granted them with `agent_env`.
   */
  private buildEnv(access?: Pick<AgentAccess, "envVars" | "withhold">): Record<string, string> {
    const full: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
    );
    const authed = resolveCodexAuthEnv(full);
    const passthrough = this.envPassthrough ?? parseList(process.env.SWENY_ENV_PASSTHROUGH);
    let env = authed;
    if (resolveEnvScope(process.env, this.envScope, this.logger)) {
      const scoped = scopeAgentEnv(authed, {
        extraVars: access?.envVars ?? [],
        passthrough,
        authVars: CODEX_AUTH_VARS,
        prefixes: CODEX_ENV_PREFIXES,
        logger: this.logger,
      });
      reportWithheldEnv(scoped.withheld, this.logger);
      env = scoped.env;
    }
    return finishAgentEnv(env, { access, keep: CODEX_AUTH_VARS, passthrough, logger: this.logger }).env;
  }

  /** The node policy after `disallowed_tools` names are translated into Codex classes. */
  private compilePolicy(req: HarnessRunRequest, maxTurns: number): NodePolicy {
    // A node policy (#365) can make the run stricter, never looser than the
    // harness policy mode.
    const base: NodePolicy = req.policy
      ? { ...req.policy, strict: req.policy.strict || this.policyMode === "strict" }
      : {
          readOnly: !!req.readOnly,
          deny: req.deny ?? [],
          nativeDeny: req.disallowedTools,
          egress: req.agentAccess?.domains ?? [],
          strict: this.policyMode === "strict",
        };
    const { classes, unknown } = translateDenyNames(base.nativeDeny);
    return {
      ...base,
      deny: [...new Set([...base.deny, ...classes])],
      nativeDeny: unknown,
      maxTurns: base.maxTurns ?? maxTurns,
    };
  }

  /** Resolve the Codex `--sandbox` value for a normal (not read-only) run. */
  private resolveSandbox(mode: SandboxMode): { mode: "workspace-write" | "danger-full-access"; error?: string } {
    if (mode === "off") return { mode: "danger-full-access" };
    const reason = (this.sandboxProbe ?? (() => checkSandboxSupport()))();
    if (!reason) return { mode: "workspace-write" };
    if (mode === "strict") {
      return {
        mode: "workspace-write",
        error: `SWENY_SANDBOX=strict but the Codex sandbox cannot run on this host: ${reason}`,
      };
    }
    if (!this.sandboxWarned) {
      this.sandboxWarned = true;
      const prefix = process.env.GITHUB_ACTIONS === "true" ? "::warning title=SWEny agent sandbox::" : "";
      this.logger.warn(`${prefix}Codex commands will run unsandboxed (SWENY_SANDBOX=auto): ${reason}`);
    }
    return { mode: "danger-full-access" };
  }

  /** argv shared by run() and complete(). */
  private baseArgs(opts: {
    model?: string;
    sandbox: "read-only" | "workspace-write" | "danger-full-access";
    deny: Set<ToolClass>;
    network: boolean;
  }): string[] {
    const args = [
      ...this.codexCommand.args,
      "exec",
      "--json",
      "--color",
      "never",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--cd",
      this.cwd,
      "--sandbox",
      opts.sandbox,
      ...cfg("approval_policy", "never"),
      ...cfg("check_for_update_on_startup", false),
      ...cfg("developer_instructions", SYSTEM_PROMPT),
    ];
    if (opts.model) args.push("--model", opts.model);
    for (const f of CODEX_ISOLATION_FEATURES_OFF) args.push(...cfg(`features.${f}`, false));
    if (opts.deny.has("shell")) args.push(...cfg("features.shell_tool", false));
    if (opts.deny.has("net")) args.push(...cfg("web_search", "disabled"));
    if (opts.deny.has("subagent")) {
      args.push(...cfg("features.multi_agent", false), ...cfg("agents.enabled", false));
    }
    if (opts.sandbox === "workspace-write") {
      args.push(...cfg("sandbox_workspace_write.network_access", opts.network));
    }
    const baseUrl = process.env.OPENAI_BASE_URL;
    if (baseUrl) args.push(...cfg("openai_base_url", baseUrl));
    return args;
  }

  /** `-c mcp_servers.<id>.*` for each server. Returns the args and anything Codex cannot load. */
  private mcpArgs(servers: Record<string, McpServerConfig>): { args: string[]; unsupported: string[] } {
    const args: string[] = [];
    const unsupported: string[] = [];
    for (const [id, s] of Object.entries(servers)) {
      const key = `mcp_servers.${keySegment(id)}`;
      if (s.type === "http" || (!s.type && s.url && !s.command)) {
        if (!s.url) {
          unsupported.push(`${id} (http without url)`);
          continue;
        }
        args.push(...cfg(`${key}.url`, s.url));
        if (s.headers && Object.keys(s.headers).length > 0) args.push(...cfg(`${key}.http_headers`, s.headers));
        continue;
      }
      if (!s.command) {
        unsupported.push(`${id} (type ${String((s as { type?: unknown }).type)})`);
        continue;
      }
      args.push(...cfg(`${key}.command`, s.command));
      if (s.args && s.args.length > 0) args.push(...cfg(`${key}.args`, s.args));
      if (s.env && Object.keys(s.env).length > 0) args.push(...cfg(`${key}.env`, s.env));
    }
    return { args, unsupported };
  }

  /** Spawn codex exec, feed the prompt on stdin, and read JSONL until it exits. */
  private async exec(opts: {
    /** What to spawn: `codex exec ...`, or the sandbox wrapper around it. */
    spawn: AgentSpawn;
    prompt: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    maxToolCalls?: number;
    onProgress?: (message: string) => void;
  }): Promise<ExecOutcome> {
    const out: ExecOutcome = {
      completed: false,
      exitCode: null,
      exitSignal: null,
      stderrTail: "",
      messages: [],
      toolCalls: [],
    };
    const byId = new Map<string, ToolCall>();
    let toolCount = 0;
    let stopped = false;

    const abort = makeAbort(opts.timeoutMs, opts.signal);
    if (abort?.controller.signal.aborted) {
      // Aborted before Codex started: nothing to spawn or stop.
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
        detached: process.platform !== "win32",
      });
    } catch (err) {
      abort?.clear();
      out.spawnError = err instanceof Error ? err.message : String(err);
      return out;
    }
    trackChild(child);

    let finish!: () => void;
    const closed = new Promise<void>((resolve) => {
      finish = resolve;
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

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stopChild(child, "SIGTERM");
      killTimer = setTimeout(() => {
        stopChild(child, "SIGKILL");
        // An escaped descendant or failed OS kill must not retain this await
        // through inherited pipes after cancellation or leader exit.
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish();
      }, this.killGraceMs);
      killTimer.unref?.();
    };
    child.once("exit", (code, signal) => {
      out.exitCode = code;
      out.exitSignal = signal;
      // The leader is done, but its descendants may still own our pipes.
      stop();
    });
    if (abort) {
      const onAbort = () => {
        out.abortReason = abort.reason();
        stop();
      };
      abort.controller.signal.addEventListener("abort", onAbort, { once: true });
      if (abort.controller.signal.aborted) onAbort();
    }

    child.stdin?.on("error", () => {
      // Codex exited before reading the prompt; the exit code tells the story.
    });
    child.stdin?.end(opts.prompt);

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.logger.debug(`[codex] ${chunk.trimEnd()}`);
      out.stderrTail = (out.stderrTail + chunk).slice(-2000);
    });

    const startCall = (id: string, call: ToolCall) => {
      out.toolCalls.push(call);
      byId.set(id, call);
      toolCount++;
      if (opts.maxToolCalls !== undefined && toolCount > opts.maxToolCalls && !out.overBudget) {
        out.overBudget = { count: toolCount, limit: opts.maxToolCalls };
        stop();
      }
    };

    const onItem = (phase: "started" | "updated" | "completed", item: Record<string, any>) => {
      const id = typeof item.id === "string" ? item.id : "";
      const kind = item.type as string;
      if (kind === "agent_message") {
        if (phase === "completed" && typeof item.text === "string") out.messages.push(item.text);
        return;
      }
      if (kind === "error") {
        if (typeof item.message === "string") this.logger.warn(`  codex: ${item.message}`);
        return;
      }
      if (!TOOL_ITEM_KINDS.has(kind)) return;

      let call = byId.get(id);
      if (!call) {
        if (phase === "updated") return;
        const input =
          kind === "command_execution"
            ? { command: item.command }
            : kind === "file_change"
              ? { changes: item.changes }
              : kind === "mcp_tool_call"
                ? item.arguments
                : kind === "web_search"
                  ? { query: item.query }
                  : { prompt: item.prompt };
        const tool =
          kind === "command_execution"
            ? "shell"
            : kind === "file_change"
              ? "apply_patch"
              : kind === "mcp_tool_call" || kind === "collab_tool_call"
                ? String(item.tool ?? "")
                : "web_search";
        call = { tool, input };
        startCall(id, call);
        const detail = kind === "command_execution" ? `shell: ${String(item.command ?? "")}` : tool;
        opts.onProgress?.(detail.length > 80 ? detail.slice(0, 79) + "…" : detail);
      }
      if (phase !== "completed" || call.status !== undefined) return;

      const status = String(item.status ?? "");
      if (kind === "mcp_tool_call") {
        const resultIsError = item.result?.is_error === true || item.result?.isError === true;
        if (status === "failed" || resultIsError || item.error) {
          const detail = item.error?.message ?? parseToolResultContent(item.result?.content ?? "");
          call.status = "error";
          call.output = { error: detail };
          this.logger.warn(`  tool ${call.tool} failed: ${summarizeToolError(detail)}`);
        } else {
          const content = item.result?.content;
          const hasContent = Array.isArray(content) ? content.length > 0 : content !== undefined;
          call.status = "success";
          call.output = hasContent ? parseToolResultContent(content) : (item.result?.structured_content ?? null);
        }
      } else if (kind === "command_execution") {
        const ok = status === "completed" && (item.exit_code === 0 || item.exit_code === undefined);
        call.status = ok ? "success" : "error";
        call.output = ok ? item.aggregated_output : { error: item.aggregated_output ?? status };
      } else {
        const ok = status !== "failed";
        call.status = ok ? "success" : "error";
        call.output = ok ? (item.results ?? item.changes ?? null) : { error: status };
      }
    };

    let buf = "";
    const onLine = (line: string) => {
      if (stopped && out.overBudget) return;
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: Record<string, any>;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        this.logger.debug(`[codex] non-JSON stdout line ignored`);
        return;
      }
      switch (ev.type) {
        case "item.started":
        case "item.updated":
        case "item.completed":
          if (ev.item && typeof ev.item === "object") onItem(ev.type.slice(5) as "started", ev.item);
          break;
        case "turn.completed":
          out.completed = true;
          out.usage = mapUsage(ev.usage);
          break;
        case "turn.failed":
          out.failure = String(ev.error?.message ?? "turn failed");
          break;
        case "error":
          // Codex also reports errors it retries past (exec's jsonl processor
          // maps every app-server Error notification here), so this is only
          // the reason when no turn.completed follows.
          out.lastError = String(ev.message ?? "codex error");
          break;
        default:
          break;
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        onLine(line);
      }
    });

    await closed;
    // A final line without a newline is complete only if it parses.
    if (buf.trim()) onLine(buf);
    if (killTimer) clearTimeout(killTimer);
    stopChild(child, "SIGKILL");
    abort?.clear();
    liveChildren.delete(child);
    return out;
  }

  /**
   * Run a node. The gate runs first: in strict mode a node whose opinions
   * Codex cannot honor is refused before Codex starts. With a sandbox mode
   * other than off, the whole Codex process runs inside the host's process
   * sandbox wrapper (#360 step 2) when there is one, which also keeps the
   * node's per-host egress allowlist that Codex cannot keep itself.
   */
  async run(req: HarnessRunRequest): Promise<HarnessRunResult> {
    const maxTurns = req.maxTurns ?? this.maxTurns;
    const mode: SandboxMode = req.policy?.sandbox ?? resolveSandboxMode(process.env, this.sandboxMode, this.logger);
    const env = withPushBlocked(this.buildEnv(req.agentAccess), req.agentAccess?.noPush);
    const compiled = this.compilePolicy(req, maxTurns);
    const held = heldCredentials(env, req.agentAccess?.withhold);
    const policy: NodePolicy = {
      ...compiled,
      sandbox: mode,
      ...(held.length > 0 ? { agentCredentials: held } : {}),
      ...(req.agentAccess?.noPush && !compiled.readOnly ? { stagedWrite: true } : {}),
    };
    // Codex's network is one switch, not a host list, so any sandbox mode but
    // off needs the process wrapper for full containment.
    const needsWrapper = mode !== "off" && !(this.capabilities.sandbox.fs && this.capabilities.sandbox.network);
    const wrapper =
      needsWrapper && this.sandboxWrapper !== null
        ? (this.sandboxWrapper ?? (await defaultSandboxWrapper()).wrapper)
        : undefined;
    const gate = policyGate(this.capabilities, policy, wrappersFrom(wrapper));
    let degraded = gate.degraded;
    const tag = (r: NodeResult, extra: string[] = []): HarnessRunResult => ({
      ...r,
      harness: this.info(),
      degraded: [...degraded, ...extra],
    });
    const refused = (why: string, extra: string[] = []): HarnessRunResult => {
      const msg = `codex refused this node: ${why}`;
      this.logger.error(msg);
      // `refused` keeps fail_soft from softening a policy refusal (executor.ts).
      return tag({ status: "failed", data: { error: msg, refused: true }, toolCalls: [] }, extra);
    };

    if (gate.refuse) return refused(gate.refuse);

    const pre = await this.checkCli();
    if (!pre.ok) {
      this.logger.error(pre.reason);
      return tag({ status: "failed", data: { error: pre.reason }, toolCalls: [] });
    }

    const readOnly = policy.readOnly;
    const deny = new Set<ToolClass>(policy.deny);
    // Read-only keeps the shell. Codex has no non-shell way to read a file
    // (apply_patch only writes), so dropping it left read-only nodes (triage
    // gather/investigate, implement analyze, drift inventory) blind. The shell
    // is safe here because `--sandbox read-only` is enforced by the OS, not by
    // the model: it maps to SandboxPolicy::ReadOnly { network_access: false },
    // "read-only access ... outbound network ... false by default"
    // (openai/codex rust-v0.159.2, codex-rs/protocol/src/protocol.rs, the
    // SandboxPolicy enum ~L1079 and new_read_only_policy ~L1205). So a shell
    // command can read the checkout but cannot write files or reach the
    // network. Network and subagents are still denied at the tool level, and an
    // explicit `tools.deny: [shell]` (already in policy.deny) still removes it.
    if (readOnly) for (const c of ["net", "subagent"] as ToolClass[]) deny.add(c);

    let sandbox: "read-only" | "workspace-write" | "danger-full-access" = "read-only";
    if (!readOnly) {
      if (wrapper) {
        // The wrapper contains the whole process; Codex's own sandbox nested
        // inside it would only get in the way.
        sandbox = "danger-full-access";
      } else {
        const s = this.resolveSandbox(mode);
        if (s.error) {
          this.logger.error(s.error);
          return tag({ status: "failed", data: { error: s.error }, toolCalls: [] });
        }
        sandbox = s.mode;
      }
    }

    if (wrapper && !env.CODEX_API_KEY && !env.CODEX_ACCESS_TOKEN && !this.loginWarned) {
      this.loginWarned = true;
      this.logger.warn(
        "Codex runs inside the sandbox wrapper, where a stored `codex login` is not readable; set CODEX_API_KEY or OPENAI_API_KEY.",
      );
    }
    const extraDegraded: string[] = [];
    let bridge: ToolBridge | undefined;
    let scratch: string | undefined;

    try {
      // Dry run: external MCP servers cannot be classified per tool, so only
      // sweny's own (already read-filtered) skill tools remain.
      const servers: Record<string, McpServerConfig> = readOnly
        ? {}
        : { ...this.defaultMcpServers, ...req.mcpServers, ...this.mcpServers };
      const { args: mcpArgs, unsupported } = this.mcpArgs(servers);
      if (unsupported.length > 0) {
        const note = `mcp: codex cannot load ${unsupported.join(", ")}`;
        this.logger.warn(`  ${note}`);
        extraDegraded.push(note);
      }
      const toolArgs: string[] = [];
      if (req.tools.length > 0) {
        bridge = await startToolBridge({
          tools: req.tools,
          context: this.defaultContext,
          logger: this.logger,
          ...(this.toolBridgeShim ? { shimCommand: this.toolBridgeShim } : {}),
        });
        const shim = bridge.mcpServer;
        // The token reaches the shim by name (`env_vars`), never in argv.
        env[TOKEN_ENV] = bridge.token;
        const key = "mcp_servers.sweny-core";
        toolArgs.push(
          ...cfg(`${key}.command`, shim.command),
          ...cfg(`${key}.args`, shim.args ?? []),
          ...cfg(`${key}.env`, { SWENY_NO_UPDATE_CHECK: "1" }),
          ...cfg(`${key}.env_vars`, [TOKEN_ENV]),
          ...cfg(`${key}.required`, true),
          ...cfg(`${key}.startup_timeout_sec`, 30),
          ...cfg(`${key}.tool_timeout_sec`, 600),
        );
      }

      const prompt = buildNodePrompt(req.instruction, req.context, req.outputSchema);
      let schemaArgs: string[] = [];
      if (req.outputSchema) {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-codex-"));
        const schemaPath = path.join(scratch, "output-schema.json");
        fs.writeFileSync(schemaPath, JSON.stringify(req.outputSchema), { mode: 0o600 });
        schemaArgs = ["--output-schema", schemaPath];
      }

      const argsFor = (withSchema: boolean) => [
        ...this.baseArgs({
          model: req.model ?? this.model,
          sandbox,
          deny,
          network: !deny.has("net"),
        }),
        ...mcpArgs,
        ...toolArgs,
        ...(withSchema ? schemaArgs : []),
        "-",
      ];

      // Gate and (maybe) wrap each spawn; the wrapper's scratch goes away with the process.
      const execOnce = async (withSchema: boolean): Promise<ExecOutcome | { refuse: string }> => {
        const prep = await prepareAgentSpawn({
          caps: this.capabilities,
          policy,
          spawn: { command: this.codexCommand.command, args: argsFor(withSchema), env, cwd: this.cwd },
          wrapper: wrapper ?? null,
          harnessEgress: codexBackendHosts(),
          env: process.env,
        });
        degraded = prep.degraded;
        if (prep.refuse) {
          await prep.cleanup();
          return { refuse: prep.refuse };
        }
        try {
          return await this.exec({
            spawn: prep.spawn,
            prompt,
            timeoutMs: req.timeoutMs,
            signal: req.signal,
            maxToolCalls: maxTurns,
            onProgress: req.onProgress,
          });
        } finally {
          await prep.cleanup();
        }
      };

      let out = await execOnce(schemaArgs.length > 0);
      if ("refuse" in out) return refused(out.refuse);
      // OpenAI strict structured outputs reject some JSON schemas. When Codex
      // fails on the schema before doing anything, run once more without the
      // native schema in relaxed mode. Prompt-only output is not schema-validated.
      if (
        schemaArgs.length > 0 &&
        !out.completed &&
        !out.abortReason &&
        out.toolCalls.length === 0 &&
        /schema|response_format|text\.format/i.test(`${out.failure ?? ""} ${out.lastError ?? ""} ${out.stderrTail}`)
      ) {
        const why = isStrictCompatibleSchema(req.outputSchema)
          ? "codex rejected the output schema"
          : "the output schema is not OpenAI strict-compatible";
        extraDegraded.push(`structured_output: ${why}; native schema validation unavailable`);
        if (policy.strict) {
          return refused(
            "strict policy requires structured_output validation; refusing prompt-only fallback",
            extraDegraded,
          );
        }
        this.logger.warn(`  codex: ${why}; retrying without --output-schema`);
        const again = await execOnce(false);
        if ("refuse" in again) return refused(again.refuse);
        out = again;
      }

      return tag(this.toResult(out, req.outputSchema, req.timeoutMs), extraDegraded);
    } catch (err) {
      const msg = `Codex run failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(msg);
      return tag({ status: "failed", data: { error: msg }, toolCalls: [] }, extraDegraded);
    } finally {
      await bridge?.close();
      if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  /** Map one exec outcome onto a NodeResult with Claude Code's semantics. */
  private toResult(out: ExecOutcome, outputSchema: JSONSchema | undefined, timeoutMs?: number): NodeResult {
    const { toolCalls, usage } = out;
    const withUsage = (r: NodeResult): NodeResult => (usage ? { ...r, usage } : r);
    const last = out.messages.at(-1) ?? "";
    const fail = (error: string, partial = false): NodeResult => {
      this.logger.error(error);
      return withUsage({
        status: "failed",
        data: { error, ...(partial && last.trim() !== "" ? { summary: last.trim() } : {}) },
        toolCalls,
      });
    };

    if (out.spawnError) return fail(`Codex could not start: ${out.spawnError}`);
    if (out.abortReason === "timeout") return fail(`Codex run timed out after ${timeoutMs}ms`);
    if (out.abortReason === "signal") return fail("Codex run aborted");
    if (out.overBudget) {
      // Same shape as Claude Code's max_turns stop: partial text is kept for fail_soft nodes.
      return fail(
        `Codex run terminated early: max_turns (${out.overBudget.limit} tool calls; stopped by the sweny watchdog)`,
        true,
      );
    }
    if (out.failure) return fail(`Codex run failed: ${out.failure}`, true);
    if (!out.completed) {
      if (out.lastError) return fail(`Codex run failed: ${out.lastError}`, true);
      const code = out.exitSignal ? `signal ${out.exitSignal}` : `code ${out.exitCode}`;
      const tail = out.stderrTail.trim().split("\n").slice(-3).join(" | ");
      return fail(
        out.exitCode === 0 && !out.exitSignal
          ? `agent stream ended without a result message (${toolCalls.length} tool calls captured)`
          : `Codex exited with ${code}${tail ? `: ${tail}` : ""}`,
      );
    }
    if (out.exitCode !== 0 || out.exitSignal) {
      const code = out.exitSignal ? `signal ${out.exitSignal}` : `code ${out.exitCode}`;
      return fail(`Codex exited with ${code} after completing the turn`);
    }

    const parsed = tryParseJSON(last, outputSchema, this.logger, "Codex");
    return withUsage({ status: "success", data: { summary: last, ...parsed }, toolCalls });
  }

  /**
   * One completion: read-only sandbox, no shell, no web search, no subagents,
   * no MCP. null when it failed (callers fail closed).
   */
  async complete(req: HarnessCompleteRequest): Promise<string | null> {
    const purpose = req.purpose ?? "ask";
    const failClosed = (why: string): null => {
      this.logger.warn(
        purpose === "evaluate"
          ? `codex.evaluate: ${why}. Failing closed (no route decision).`
          : `codex.ask: ${why}. Returning empty string.`,
      );
      return null;
    };
    const pre = await this.checkCli();
    if (!pre.ok) return failClosed(pre.reason);

    const args = [
      ...this.baseArgs({
        // An empty model (the judge default) means Codex's own default model.
        model: req.model || this.model,
        sandbox: "read-only",
        deny: new Set<ToolClass>(["shell", "net", "subagent"]),
        network: false,
      }),
      "-",
    ];
    const out = await this.exec({
      spawn: { command: this.codexCommand.command, args, env: this.buildEnv(), cwd: this.cwd },
      prompt: req.prompt,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      // Classification calls use no tools; any tool call is over budget.
      maxToolCalls: 0,
    });
    if (out.spawnError) return failClosed(`codex could not start: ${out.spawnError}`);
    if (out.abortReason === "timeout") return failClosed(`timed out after ${req.timeoutMs}ms`);
    if (out.abortReason === "signal") return failClosed("aborted");
    if (out.overBudget) return failClosed("the model tried to call a tool");
    if (out.failure) return failClosed(`codex failed: ${out.failure}`);
    if (!out.completed) return failClosed(out.lastError ?? "agent stream ended without a result message");
    if (out.exitCode !== 0 || out.exitSignal) return failClosed(`codex exited with code ${out.exitCode}`);
    return out.messages.at(-1) ?? "";
  }
}
