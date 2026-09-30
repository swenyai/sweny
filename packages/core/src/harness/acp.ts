/**
 * ACP harness (#416): runs a node on any Agent Client Protocol agent
 * (`--agent acp:<command>`, for example `acp:opencode acp`,
 * `acp:hermes acp`, `acp:goose acp`, `acp:gemini --experimental-acp`).
 *
 * ACP is the long-tail adapter. It is JSON-RPC 2.0 over the agent's stdio and
 * carries a prompt and a stream of updates; it does not carry sweny's
 * opinions. Read from agentclientprotocol/agent-client-protocol at tag
 * schema-v1.24.1 (`schema/v1/schema.json`, `docs/protocol/v1/*.mdx`):
 * - transports: newline-delimited JSON over stdio (`transports.mdx`).
 * - `initialize` negotiates `protocolVersion` (1) and capabilities
 *   (`initialization.mdx`); `InitializeRequest` / `InitializeResponse`.
 * - `session/new {cwd, mcpServers}` returns `{sessionId}`; every agent MUST
 *   support stdio MCP servers, http and sse are optional
 *   (`session-setup.mdx`, `McpServerStdio`, `McpServerHttp`).
 * - `session/prompt {sessionId, prompt: ContentBlock[]}` streams
 *   `session/update` notifications (`agent_message_chunk`, `tool_call`,
 *   `tool_call_update`, `usage_update`, ...) and ends with
 *   `{stopReason}`; `PromptResponse` has no other field (`prompt-turn.mdx`).
 * - `session/cancel` (notification) ends a turn with stopReason `cancelled`
 *   (`prompt-turn.mdx`, Cancellation); pending permission requests get the
 *   `cancelled` outcome.
 * - `session/request_permission {toolCall, options}` is how an agent MAY ask
 *   before a tool runs; the client picks an option or answers `cancelled`
 *   (`tool-calls.mdx`, `RequestPermissionResponse`).
 * - `fs/read_text_file` and `fs/write_text_file` are client methods an agent
 *   may use only when the client advertised them (`file-system.mdx`).
 *
 * Every sweny opinion is enforced by sweny here, refused or reported as
 * `degraded` by `policyGate` (see ACP_CAPABILITIES for the honest list):
 * - Structured output: the schema rides in the prompt; sweny parses the last
 *   JSON object, checks it and asks once more before giving up.
 * - Tool deny and read-only: best effort through `session/request_permission`
 *   (denied classes and every non-read tool under `readOnly` are rejected),
 *   plus a refusal of every `fs/write_text_file`. The protocol has no deny list
 *   and an agent that does not ask is not stopped, so `policyGate` still
 *   reports deny and read-only as unenforced; strict refuses the node unless
 *   the process wrapper provides the read-only mount.
 * - Sandbox and egress: none in the protocol. The whole agent process runs
 *   inside the sandbox wrapper (sandbox-wrapper.ts); strict refuses without it.
 * - Env: sweny spawns the agent with the scoped env (agent-env.ts).
 * - Skill tools: passed in `session/new` as the stdio MCP server of the tool
 *   bridge (#414), so the executor still observes every call.
 * - Turn limit: a watchdog counts tool calls and cancels past the budget.
 * - Timeout: `session/cancel`, a grace period, then the process is killed.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { JSONSchema, Logger, McpServerConfig, NodeResult, NodeUsage, ToolCall, ToolContext } from "../types.js";
import { consoleLogger } from "../types.js";
import {
  parseList,
  reportWithheldEnv,
  resolveEnvScope,
  resolveSandboxMode,
  scopeAgentEnv,
  type SandboxMode,
} from "../agent-env.js";
import type {
  AgentHarness,
  HarnessCapabilities,
  HarnessCompleteRequest,
  HarnessId,
  HarnessInfo,
  HarnessRunRequest,
  HarnessRunResult,
  NodePolicy,
  ToolClass,
} from "./types.js";
import { ACP_CAPABILITIES } from "./capabilities.js";
import { policyGate, resolveHarnessPolicy, TOOL_CLASSES, type HarnessPolicyMode } from "./policy.js";
import { buildNodePrompt } from "./prompts.js";
import { makeAbort } from "./abort.js";
import { parseToolResultContent, schemaMismatches, summarizeToolError, tryParseJSON } from "./parse.js";
import { startToolBridge, type ToolBridge } from "./tool-bridge/server.js";
import {
  defaultSandboxWrapper,
  prepareAgentSpawn,
  wrappersFrom,
  type AgentSpawn,
  type SandboxWrapper,
} from "./sandbox-wrapper.js";
import { TOKEN_ENV } from "./tool-bridge/protocol.js";
import { translateDenyNames } from "./codex.js";
import { RPC_ERROR, RpcError, RpcPeer, splitCommandLine } from "./acp-rpc.js";

export { ACP_CAPABILITIES };

/** The ACP major version sweny speaks (`InitializeRequest.protocolVersion`). */
export const ACP_PROTOCOL_VERSION = 1;

/** The reason every pending request is rejected with when the agent process is gone. */
const PROCESS_EXITED = "agent process exited";

/** Name of the MCP server that carries sweny's skill tools (the tool bridge). */
const BRIDGE_SERVER = "sweny-core";

export interface AcpHarnessOptions {
  /**
   * The agent to run: a command line (`"opencode acp"`, the part after `acp:`)
   * or an explicit `{command, args}`. Never run through a shell.
   */
  acpCommand?: string | { command: string; args: string[] };
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
  /** The agent's own auth env var names, always passed through when scoping (none are assumed). */
  authVars?: string[];
  /** Scope the agent env to the allowlist. Default: `SWENY_ENV_SCOPE`, else on in CI. */
  envScope?: boolean;
  /** Process sandbox mode. Default: `SWENY_SANDBOX`, else `auto` in CI and `off` locally. */
  sandbox?: SandboxMode;
  /** The host's process sandbox wrapper (#360 step 2). `undefined` = detect srt once per process; `null` = none (test seam). */
  sandboxWrapper?: SandboxWrapper | null;
  /** `strict` refuses a node with unenforceable opinions. Default: {@link resolveHarnessPolicy}. */
  policy?: HarnessPolicyMode;
  /** Hosts the agent itself needs (its model API), allowed through the sandbox wrapper. */
  egress?: string[];
  /** Shim command override for the tool bridge (test seam). */
  toolBridgeShim?: { command: string; args: string[] };
  /** Grace period between SIGTERM and SIGKILL, and for the agent to exit on its own (default: 2000 ms). */
  killGraceMs?: number;
  /** How long the agent gets to answer `session/cancel` before it is killed (default: 5000 ms). */
  cancelGraceMs?: number;
  /** How long `initialize` and `session/new` may take (default: 60000 ms). */
  startupTimeoutMs?: number;
}

// ─── Tool classification (permission requests) ───────────────────

/** Portable tool classes an ACP tool call can be, from its `kind` (schema `ToolKind`) and name. */
export function classifyAcpTool(
  kind: string | null | undefined,
  name: string | null | undefined,
): { classes: ToolClass[]; readOnlySafe: boolean } {
  switch (kind) {
    case "read":
    case "search":
    case "think":
      return { classes: [], readOnlySafe: true };
    case "edit":
      return { classes: ["write", "edit"], readOnlySafe: false };
    case "delete":
    case "move":
      return { classes: ["write"], readOnlySafe: false };
    case "execute":
      return { classes: ["shell"], readOnlySafe: false };
    case "fetch":
      return { classes: ["net"], readOnlySafe: false };
    default: {
      // `other`, `switch_mode` and anything the agent invented: only the name can say.
      const named = name ? translateDenyNames([name]).classes : [];
      return { classes: named, readOnlySafe: false };
    }
  }
}

/** Does this tool call name one of sweny's skill tools (they reach the agent as MCP tools of the tool bridge)? */
export function isSkillToolCall(names: readonly (string | null | undefined)[], skillTools: readonly string[]): boolean {
  const have = names.filter((n): n is string => typeof n === "string" && n !== "");
  return skillTools.some((t) =>
    [t, `${BRIDGE_SERVER}_${t}`, `${BRIDGE_SERVER}__${t}`, `mcp__${BRIDGE_SERVER}__${t}`, `${BRIDGE_SERVER}.${t}`].some(
      (c) => have.includes(c),
    ),
  );
}

interface PermissionOption {
  optionId: string;
  kind: string;
}

/** The permission outcome for an option list: the first option of a wanted kind, else `cancelled`. */
export function pickPermissionOutcome(
  options: readonly PermissionOption[],
  allow: boolean,
): { outcome: "selected"; optionId: string } | { outcome: "cancelled" } {
  const wanted = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  for (const kind of wanted) {
    const hit = options.find((o) => o.kind === kind);
    if (hit) return { outcome: "selected", optionId: hit.optionId };
  }
  return { outcome: "cancelled" };
}

// ─── Helpers ─────────────────────────────────────────────────────

/** A loosely typed JSON object, for reading what the agent sends. */
type Obj = Record<string, any>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The text of a `ContentBlock` (schema `ContentBlock`: `{type:"text", text}`), or "". */
function blockText(block: unknown): string {
  return isObj(block) && block.type === "text" && typeof block.text === "string" ? block.text : "";
}

/** `McpServerConfig` map to the ACP `mcpServers` array (schema `McpServer`). Returns what the agent cannot load too. */
export function toAcpMcpServers(
  servers: Record<string, McpServerConfig>,
  agentHttp: boolean,
): { list: Obj[]; unsupported: string[] } {
  const list: Obj[] = [];
  const unsupported: string[] = [];
  for (const [name, s] of Object.entries(servers)) {
    if (s.type === "http" || (!s.type && s.url && !s.command)) {
      if (!s.url) {
        unsupported.push(`${name} (http without url)`);
      } else if (!agentHttp) {
        unsupported.push(`${name} (agent has no http MCP transport)`);
      } else {
        list.push({
          type: "http",
          name,
          url: s.url,
          headers: Object.entries(s.headers ?? {}).map(([k, v]) => ({ name: k, value: v })),
        });
      }
      continue;
    }
    if (!s.command) {
      unsupported.push(`${name} (type ${String((s as { type?: unknown }).type)})`);
      continue;
    }
    list.push({
      name,
      command: s.command,
      args: s.args ?? [],
      env: Object.entries(s.env ?? {}).map(([k, v]) => ({ name: k, value: v })),
    });
  }
  return { list, unsupported };
}

function resolveOnPath(command: string, env: Record<string, string | undefined>): string | undefined {
  const ok = (p: string) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (command.includes(path.sep) || command.includes("/")) return ok(command) ? command : undefined;
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, command);
    if (ok(p)) return p;
  }
  return undefined;
}

// ─── Process registry (crash cleanup) ────────────────────────────

const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

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
    // A crashing sweny must not leave an agent (and its MCP servers) running.
    process.on("exit", () => {
      for (const c of liveChildren) stopChild(c, "SIGKILL");
    });
  }
}

// ─── One ACP conversation ────────────────────────────────────────

interface Turn {
  stopReason: string;
  /** The agent's last message of the turn (text after its last tool call). */
  text: string;
}

interface Conversation {
  turns: Turn[];
  toolCalls: ToolCall[];
  /** Latest cumulative cost in USD from `usage_update`. */
  costUsd?: number;
  /** Failure before or during a turn: a JSON-RPC error, a protocol problem, or a startup timeout. */
  error?: { message: string; code?: number };
  spawnError?: string;
  abortReason?: "timeout" | "signal";
  overBudget?: { count: number; limit: number };
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  stderrTail: string;
  agentVersion?: string;
  unsupportedMcp: string[];
  /** Permission requests answered with a rejection, by title. */
  rejected: string[];
}

interface ConverseOptions {
  spawn: AgentSpawn;
  cwd: string;
  mcpServers: Record<string, McpServerConfig>;
  prompt: string;
  /** After each `end_turn`: the next prompt, or undefined to stop. Used for the structured-output retry. */
  followUp?: (turn: Turn) => string | undefined;
  /** Permission policy. */
  readOnly: boolean;
  deny: ReadonlySet<ToolClass>;
  /** Names of sweny's skill tools, which stay allowed under read-only. */
  skillTools: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  maxToolCalls?: number;
  onProgress?: (message: string) => void;
}

// ─── Adapter ─────────────────────────────────────────────────────

export class AcpHarness implements AgentHarness {
  readonly id: HarnessId;
  readonly capabilities: HarnessCapabilities = ACP_CAPABILITIES;
  /** Empty on purpose: judges use the agent's own default model. */
  readonly defaultJudgeModel = "";
  readonly logger: Logger;
  private agent: { command: string; args: string[] };
  private maxTurns: number;
  private cwd: string;
  private defaultContext: ToolContext;
  private mcpServers: Record<string, McpServerConfig>;
  private defaultMcpServers: Record<string, McpServerConfig>;
  private envPassthrough: string[] | undefined;
  private authVars: string[];
  private envScope: boolean | undefined;
  private sandboxMode: SandboxMode | undefined;
  private sandboxWrapper: SandboxWrapper | null | undefined;
  private policyMode: HarnessPolicyMode;
  private egress: string[];
  private toolBridgeShim: { command: string; args: string[] } | undefined;
  private killGraceMs: number;
  private cancelGraceMs: number;
  private startupTimeoutMs: number;
  private agentVersion = "unknown";

  constructor(opts: AcpHarnessOptions = {}) {
    const given = opts.acpCommand;
    const agent =
      typeof given === "string"
        ? (() => {
            const argv = splitCommandLine(given);
            return argv.length > 0 ? { command: argv[0], args: argv.slice(1) } : undefined;
          })()
        : given;
    if (!agent || !agent.command) {
      throw new Error('ACP agent command is empty: use --agent "acp:<command>", for example acp:opencode acp');
    }
    this.agent = agent;
    this.id = `acp:${path.basename(agent.command)}`;
    this.maxTurns = opts.maxTurns ?? 20;
    this.cwd = opts.cwd ?? process.cwd();
    this.logger = opts.logger ?? consoleLogger;
    this.defaultContext = opts.defaultContext ?? { config: {}, logger: this.logger };
    this.mcpServers = opts.mcpServers ?? {};
    this.defaultMcpServers = opts.defaultMcpServers ?? {};
    this.envPassthrough = opts.envPassthrough;
    this.authVars = opts.authVars ?? [];
    this.envScope = opts.envScope;
    this.sandboxMode = opts.sandbox;
    this.sandboxWrapper = opts.sandboxWrapper;
    this.policyMode = opts.policy ?? resolveHarnessPolicy(process.env, undefined, this.logger);
    this.egress = opts.egress ?? [];
    this.toolBridgeShim = opts.toolBridgeShim;
    this.killGraceMs = opts.killGraceMs ?? 2000;
    this.cancelGraceMs = opts.cancelGraceMs ?? 5000;
    this.startupTimeoutMs = opts.startupTimeoutMs ?? 60_000;
  }

  info(): HarnessInfo {
    return { id: this.id, version: this.agentVersion };
  }

  /**
   * Is the agent command there? Deliberately does not start it: it would run
   * outside the sandbox wrapper. The version comes from `initialize` on the
   * first run (`agentInfo.version`).
   */
  async preflight(): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
    const found = resolveOnPath(this.agent.command, process.env);
    if (!found) {
      const example = [this.agent.command, ...this.agent.args].join(" ");
      return {
        ok: false,
        reason: `ACP agent command "${this.agent.command}" was not found on PATH (or is not executable). Install the agent and check that \`${example}\` starts an ACP server.`,
      };
    }
    return { ok: true, version: this.agentVersion };
  }

  /** Env for the agent process: scoped like Claude Code's, with only the auth vars the operator named. */
  private buildEnv(extraVars: readonly string[] = []): Record<string, string> {
    const full: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
    );
    if (!resolveEnvScope(process.env, this.envScope, this.logger)) return full;
    const { env, withheld } = scopeAgentEnv(full, {
      extraVars,
      passthrough: this.envPassthrough ?? parseList(process.env.SWENY_ENV_PASSTHROUGH),
      authVars: this.authVars,
      prefixes: ["LC_"],
      logger: this.logger,
    });
    reportWithheldEnv(withheld, this.logger);
    return env;
  }

  /** The node policy, with the harness policy mode and the watchdog budget applied. */
  private compilePolicy(req: HarnessRunRequest, maxTurns: number): NodePolicy {
    const base: NodePolicy = req.policy
      ? { ...req.policy, strict: req.policy.strict || this.policyMode === "strict" }
      : {
          readOnly: !!req.readOnly,
          deny: req.deny ?? [],
          nativeDeny: req.disallowedTools,
          egress: req.agentAccess?.domains ?? [],
          strict: this.policyMode === "strict",
        };
    return { ...base, maxTurns: base.maxTurns ?? maxTurns };
  }

  /**
   * Talk to one agent process from `initialize` to the last `session/prompt`
   * response, then stop it. Never throws: every failure is on the result.
   */
  private async converse(o: ConverseOptions): Promise<Conversation> {
    const out: Conversation = {
      turns: [],
      toolCalls: [],
      exitCode: null,
      exitSignal: null,
      stderrTail: "",
      unsupportedMcp: [],
      rejected: [],
    };
    const abort = makeAbort(o.timeoutMs, o.signal);
    if (abort?.controller.signal.aborted) {
      // Aborted before the agent started: nothing to spawn or stop.
      abort.clear();
      out.abortReason = abort.reason();
      return out;
    }

    let child: ChildProcess;
    try {
      child = spawn(o.spawn.command, o.spawn.args, {
        cwd: o.spawn.cwd,
        env: o.spawn.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      abort?.clear();
      out.spawnError = err instanceof Error ? err.message : String(err);
      return out;
    }
    trackChild(child);

    let sessionId: string | undefined;
    let stopRequested = false;
    let cancelSent = false;
    let exited = false;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    let toolCount = 0;
    let acceptUpdates = true;
    const byId = new Map<string, { call: ToolCall; kind?: string | null; name?: string | null }>();

    // Text of the turn in progress: one segment per agent message, a new one after every tool call.
    let segments: string[] = [];
    let startNewSegment = true;
    let lastMessageId: string | undefined;
    let costWarned = false;

    const startCall = (id: string, u: Obj) => {
      const name = typeof u.name === "string" && u.name !== "" ? u.name : typeof u.title === "string" ? u.title : id;
      const call: ToolCall = { tool: name, input: u.rawInput ?? {} };
      out.toolCalls.push(call);
      byId.set(id, { call, kind: u.kind, name: u.name ?? u.title });
      toolCount++;
      startNewSegment = true;
      if (o.onProgress) {
        const detail = typeof u.title === "string" && u.title !== "" ? u.title : name;
        o.onProgress(detail.length > 80 ? detail.slice(0, 79) + "…" : detail);
      }
      if (o.maxToolCalls !== undefined && toolCount > o.maxToolCalls && !out.overBudget) {
        out.overBudget = { count: toolCount, limit: o.maxToolCalls };
        acceptUpdates = false;
        requestStop();
      }
      return byId.get(id)!;
    };

    const settleCall = (entry: { call: ToolCall }, u: Obj) => {
      const call = entry.call;
      if (call.status !== undefined) return;
      const status = u.status;
      if (status !== "completed" && status !== "failed") return;
      const content: unknown[] = Array.isArray(u.content) ? u.content : [];
      const texts: unknown[] = [];
      const diffs: unknown[] = [];
      for (const item of content) {
        if (!isObj(item)) continue;
        if (item.type === "content" && isObj(item.content) && item.content.type === "text") texts.push(item.content);
        else if (item.type === "diff") diffs.push({ path: item.path, oldText: item.oldText, newText: item.newText });
      }
      const parsed: unknown =
        texts.length > 0 ? parseToolResultContent(texts) : (u.rawOutput ?? (diffs.length > 0 ? diffs : null));
      if (status === "failed") {
        call.status = "error";
        call.output = { error: parsed };
        this.logger.warn(`  tool ${call.tool} failed: ${summarizeToolError(parsed)}`);
      } else {
        call.status = "success";
        call.output = parsed;
      }
    };

    const onUpdate = (u: Obj) => {
      switch (u.sessionUpdate) {
        case "agent_message_chunk": {
          const text = blockText(u.content);
          if (!text) return;
          const mid = typeof u.messageId === "string" ? u.messageId : undefined;
          if (startNewSegment || (mid !== undefined && lastMessageId !== undefined && mid !== lastMessageId)) {
            segments.push("");
            startNewSegment = false;
          }
          if (mid !== undefined) lastMessageId = mid;
          segments[segments.length - 1] += text;
          return;
        }
        case "tool_call": {
          const id = typeof u.toolCallId === "string" ? u.toolCallId : "";
          if (!id) return;
          const existing = byId.get(id);
          const entry = existing ?? startCall(id, u);
          if (existing && u.rawInput !== undefined) existing.call.input = u.rawInput;
          settleCall(entry, u);
          return;
        }
        case "tool_call_update": {
          const id = typeof u.toolCallId === "string" ? u.toolCallId : "";
          if (!id) return;
          let entry = byId.get(id);
          if (!entry) entry = startCall(id, u);
          if (typeof u.name === "string" && u.name !== "") entry.call.tool = u.name;
          else if (typeof u.title === "string" && u.title !== "" && entry.name == null) entry.call.tool = u.title;
          if (typeof u.kind === "string") entry.kind = u.kind;
          if (u.rawInput !== undefined) entry.call.input = u.rawInput;
          settleCall(entry, u);
          return;
        }
        case "usage_update": {
          // `used` and `size` are context window occupancy, not billed tokens: not mapped.
          const cost = u.cost;
          if (isObj(cost) && typeof cost.amount === "number" && Number.isFinite(cost.amount)) {
            if (typeof cost.currency === "string" && cost.currency.toUpperCase() === "USD") out.costUsd = cost.amount;
            else if (!costWarned) {
              costWarned = true;
              this.logger.debug(`[acp] usage_update cost is in ${String(cost.currency)}, not USD: not recorded`);
            }
          }
          return;
        }
        default:
          return;
      }
    };

    /** `session/request_permission`: answer by policy (best effort, the agent chooses whether to ask). */
    const decide = (params: Obj): Obj => {
      const options: PermissionOption[] = Array.isArray(params.options)
        ? params.options.filter(isObj).map((x) => ({ optionId: String(x.optionId), kind: String(x.kind) }))
        : [];
      if (cancelSent) return { outcome: { outcome: "cancelled" } };
      const tc: Obj = isObj(params.toolCall) ? params.toolCall : {};
      const known = typeof tc.toolCallId === "string" ? byId.get(tc.toolCallId) : undefined;
      const kind = (typeof tc.kind === "string" ? tc.kind : undefined) ?? known?.kind;
      const name = (typeof tc.name === "string" ? tc.name : undefined) ?? known?.name;
      const title = typeof tc.title === "string" ? tc.title : undefined;
      const { classes, readOnlySafe } = classifyAcpTool(kind, name ?? title);
      const skill = isSkillToolCall([name, title], o.skillTools);
      let allow = true;
      let why = "";
      if (!skill) {
        const denied = classes.filter((c) => o.deny.has(c));
        if (denied.length > 0) {
          allow = false;
          why = `tools.deny [${denied.join(", ")}]`;
        } else if (o.readOnly && !readOnlySafe) {
          allow = false;
          why = "read-only dry run";
        }
      }
      if (!allow) {
        const label = title ?? name ?? String(tc.toolCallId ?? "tool call");
        out.rejected.push(label);
        this.logger.warn(`  acp: rejected permission request "${label}" (${why})`);
      }
      return { outcome: pickPermissionOutcome(options, allow) };
    };

    const peer: RpcPeer = new RpcPeer(child, {
      onRequest: async (method, params) => {
        const p: Obj = isObj(params) ? params : {};
        if (method === "session/request_permission") return decide(p);
        if (method === "fs/write_text_file") {
          // sweny does not advertise fs access, so a spec-following agent never calls this. One that does is refused.
          out.rejected.push(`fs/write_text_file ${String(p.path ?? "")}`.trim());
          this.logger.warn(
            `  acp: refused fs/write_text_file ${String(p.path ?? "")} (${o.readOnly ? "read-only dry run" : "sweny does not advertise client file access"})`,
          );
          throw new RpcError(
            o.readOnly
              ? "sweny refused: this is a read-only dry run"
              : "sweny did not advertise fs.writeTextFile; write the file with your own tools",
            RPC_ERROR.invalidRequest,
          );
        }
        if (method === "fs/read_text_file") {
          throw new RpcError(
            "sweny did not advertise fs.readTextFile; read the file with your own tools",
            RPC_ERROR.invalidRequest,
          );
        }
        throw new RpcError(`method not supported by sweny: ${method}`, RPC_ERROR.methodNotFound);
      },
      onNotification: (method, params) => {
        if (method !== "session/update" || !acceptUpdates) return;
        if (!isObj(params) || !isObj(params.update)) return;
        onUpdate(params.update);
      },
      onJunk: (line) => this.logger.debug(`[acp] non-JSON stdout line ignored: ${line}`),
    });

    const closed = new Promise<void>((resolve) => {
      child.once("close", (code, signal) => {
        exited = true;
        out.exitCode = code;
        out.exitSignal = signal;
        peer.end(PROCESS_EXITED);
        resolve();
      });
      child.once("error", (err) => {
        // Spawn failures (ENOENT, EACCES) have no pid and no `close` event to follow.
        if (child.pid === undefined) {
          out.spawnError = err.message;
          exited = true;
          peer.end("agent process could not start");
          resolve();
        } else {
          this.logger.debug(`[acp] child error: ${err.message}`);
        }
      });
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.logger.debug(`[acp] ${chunk.trimEnd()}`);
      out.stderrTail = (out.stderrTail + chunk).slice(-2000);
    });

    const waitExit = (ms: number) =>
      new Promise<boolean>((resolve) => {
        if (exited) return resolve(true);
        const t = setTimeout(() => resolve(exited), ms);
        t.unref?.();
        void closed.then(() => {
          clearTimeout(t);
          resolve(true);
        });
      });

    /** SIGTERM, then SIGKILL after the grace period. Resolves when the process is gone. */
    const terminate = async () => {
      if (exited) return;
      stopChild(child, "SIGTERM");
      if (await waitExit(this.killGraceMs)) return;
      stopChild(child, "SIGKILL");
      await closed;
    };

    /** Normal end: close stdin (the stdio transport's way to say goodbye), then terminate if it lingers. */
    const shutdown = async () => {
      if (exited) return;
      try {
        child.stdin?.end();
      } catch {
        // already closed
      }
      if (await waitExit(this.killGraceMs)) return;
      await terminate();
    };

    const cancelGraceMs = this.cancelGraceMs;
    /** Ask the agent to stop (`session/cancel`); kill it if it does not answer in time. */
    function requestStop(): void {
      if (stopRequested) return;
      stopRequested = true;
      if (sessionId) {
        cancelSent = true;
        peer.notify("session/cancel", { sessionId });
        cancelTimer = setTimeout(() => void terminate(), cancelGraceMs);
        cancelTimer.unref?.();
      } else {
        // Still starting up: there is no session to cancel.
        void terminate();
      }
    }

    if (abort) {
      const onAbort = () => {
        out.abortReason = abort.reason();
        requestStop();
      };
      abort.controller.signal.addEventListener("abort", onAbort, { once: true });
      if (abort.controller.signal.aborted) onAbort();
    }

    const startup = <T>(p: Promise<T>, what: string): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new RpcError(`${what} did not finish within ${this.startupTimeoutMs}ms`, RPC_ERROR.internal)),
          this.startupTimeoutMs,
        );
        t.unref?.();
        p.then(
          (v) => {
            clearTimeout(t);
            resolve(v);
          },
          (e) => {
            clearTimeout(t);
            reject(e);
          },
        );
      });

    try {
      const init = await startup(
        peer.request<Obj>("initialize", {
          protocolVersion: ACP_PROTOCOL_VERSION,
          // No fs and no terminal: the agent uses its own tools, which the sandbox wrapper contains.
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "sweny", title: "SWEny", version: "5" },
        }),
        "initialize",
      );
      if (!isObj(init) || init.protocolVersion !== ACP_PROTOCOL_VERSION) {
        throw new RpcError(
          `the agent speaks ACP protocol version ${String(isObj(init) ? init.protocolVersion : undefined)}; sweny speaks version ${ACP_PROTOCOL_VERSION}`,
          RPC_ERROR.invalidRequest,
        );
      }
      if (isObj(init.agentInfo) && typeof init.agentInfo.version === "string") {
        out.agentVersion = init.agentInfo.version;
      }
      const agentHttp = isObj(init.agentCapabilities) && init.agentCapabilities.mcpCapabilities?.http === true;
      const mcp = toAcpMcpServers(o.mcpServers, agentHttp);
      out.unsupportedMcp = mcp.unsupported;

      const session = await startup(
        peer.request<Obj>("session/new", { cwd: path.resolve(o.cwd), mcpServers: mcp.list }),
        "session/new",
      );
      if (!isObj(session) || typeof session.sessionId !== "string") {
        throw new RpcError("session/new returned no sessionId", RPC_ERROR.invalidRequest);
      }
      sessionId = session.sessionId;
      // An abort that landed during startup could not cancel a session that did not exist yet.
      if (stopRequested) {
        cancelSent = true;
        peer.notify("session/cancel", { sessionId });
      }

      // A stop that landed during startup already cancelled the session: do not prompt it.
      let prompt: string | undefined = stopRequested ? undefined : o.prompt;
      while (prompt !== undefined) {
        segments = [];
        startNewSegment = true;
        lastMessageId = undefined;
        const res = await peer.request<Obj>("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: prompt }],
        });
        const stopReason = isObj(res) && typeof res.stopReason === "string" ? res.stopReason : "unknown";
        const text = [...segments].reverse().find((s) => s.trim() !== "") ?? "";
        const turn: Turn = { stopReason, text };
        out.turns.push(turn);
        if (stopReason !== "end_turn" || stopRequested) break;
        prompt = o.followUp?.(turn);
      }
    } catch (err) {
      // After a stop we asked for, the failure is ours (timeout, budget). A process that went away has
      // its exit code and stderr reported instead. Anything else is the agent's own error.
      if (!stopRequested && !(err instanceof RpcError && err.message === PROCESS_EXITED)) {
        out.error = {
          message: err instanceof Error ? err.message : String(err),
          ...(err instanceof RpcError ? { code: err.code } : {}),
        };
      }
    } finally {
      if (cancelTimer) clearTimeout(cancelTimer);
      await shutdown();
      abort?.clear();
      liveChildren.delete(child);
      peer.end(PROCESS_EXITED);
    }
    return out;
  }

  /**
   * Run a node. The gate runs first: in strict mode a node whose opinions an
   * ACP agent cannot honor is refused before the agent starts. The agent
   * process runs inside the host's sandbox wrapper (#360 step 2) when the
   * sandbox mode asks for one and the host has one.
   */
  async run(req: HarnessRunRequest): Promise<HarnessRunResult> {
    const maxTurns = req.maxTurns ?? this.maxTurns;
    const mode: SandboxMode = req.policy?.sandbox ?? resolveSandboxMode(process.env, this.sandboxMode, this.logger);
    const policy: NodePolicy = { ...this.compilePolicy(req, maxTurns), sandbox: mode };
    // ACP has no sandbox of its own: any mode but off needs the process wrapper.
    const wrapper =
      mode !== "off" && this.sandboxWrapper !== null
        ? (this.sandboxWrapper ?? (await defaultSandboxWrapper()).wrapper)
        : undefined;
    const gate = policyGate(this.capabilities, policy, wrappersFrom(wrapper));
    let degraded = gate.degraded;
    const extraDegraded: string[] = [];
    const tag = (r: NodeResult): HarnessRunResult => ({
      ...r,
      harness: this.info(),
      degraded: [...degraded, ...extraDegraded],
    });
    const refused = (why: string): HarnessRunResult => {
      const msg = `ACP agent refused this node: ${why}`;
      this.logger.error(msg);
      // `refused` keeps fail_soft from softening a policy refusal (executor.ts).
      return tag({ status: "failed", data: { error: msg, refused: true }, toolCalls: [] });
    };
    if (gate.refuse) return refused(gate.refuse);

    const pre = await this.preflight();
    if (!pre.ok) {
      this.logger.error(pre.reason);
      return tag({ status: "failed", data: { error: pre.reason }, toolCalls: [] });
    }

    if (req.model) {
      extraDegraded.push("model: ACP has no portable model selector; the agent uses its own configured model");
    }

    const readOnly = policy.readOnly;
    // Permission answers: the node's deny list, plus legacy `disallowed_tools` names that map to a class.
    const deny = new Set<ToolClass>([...policy.deny, ...translateDenyNames(policy.nativeDeny).classes]);

    const env = this.buildEnv(req.agentAccess?.envVars);
    let bridge: ToolBridge | undefined;
    try {
      // Dry run: external MCP servers cannot be classified per tool, so only
      // sweny's own (already read-filtered) skill tools remain.
      const servers: Record<string, McpServerConfig> = readOnly
        ? {}
        : { ...this.defaultMcpServers, ...req.mcpServers, ...this.mcpServers };
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
        // The token rides in the shim's own env entry of session/new, never in argv.
        const shim = bridge.mcpServer;
        servers[BRIDGE_SERVER] = {
          ...shim,
          env: { ...(shim.env ?? {}), SWENY_NO_UPDATE_CHECK: "1", [TOKEN_ENV]: bridge.token },
        };
      }

      const basePrompt = buildNodePrompt(req.instruction, req.context, req.outputSchema);
      const schema = req.outputSchema;
      const retry = { asked: false };
      // One correction turn when the answer does not match the declared output.
      const followUp = (turn: Turn): string | undefined => {
        if (!schema || retry.asked) return undefined;
        const parsed = tryParseJSON(turn.text, schema, { warn() {} });
        const problems = schemaMismatches(parsed, schema);
        if (problems.length === 0) return undefined;
        retry.asked = true;
        this.logger.info(
          `  acp: the answer does not match the output shape (${problems.join("; ")}); asking once more`,
        );
        return [
          `Your last reply did not match the required output: ${problems.join("; ")}.`,
          "Reply again, ending with ONLY a JSON object that matches this schema:",
          "```json",
          JSON.stringify(schema, null, 2),
          "```",
        ].join("\n");
      };

      const prep = await prepareAgentSpawn({
        caps: this.capabilities,
        policy,
        spawn: { command: this.agent.command, args: this.agent.args, env, cwd: this.cwd },
        wrapper: wrapper ?? null,
        // The bridge's loopback endpoint (wrapped runs only): the one extra host the shim needs.
        harnessEgress: [...this.egress, ...(bridge?.egress ?? [])],
        env: process.env,
      });
      degraded = prep.degraded;
      if (prep.refuse) {
        await prep.cleanup();
        return refused(prep.refuse);
      }
      let conv: Conversation;
      try {
        conv = await this.converse({
          spawn: prep.spawn,
          cwd: this.cwd,
          mcpServers: servers,
          prompt: basePrompt,
          followUp,
          readOnly,
          deny,
          skillTools: req.tools.map((t) => t.name),
          timeoutMs: req.timeoutMs,
          signal: req.signal,
          maxToolCalls: maxTurns,
          onProgress: req.onProgress,
        });
      } finally {
        await prep.cleanup();
      }

      if (conv.agentVersion) this.agentVersion = conv.agentVersion;
      for (const u of conv.unsupportedMcp) {
        const note = `mcp: the ACP agent cannot load ${u}`;
        this.logger.warn(`  ${note}`);
        extraDegraded.push(note);
      }
      const result = this.toResult(conv, schema, req.timeoutMs);
      if (result.status === "success" && schema && retry.asked) {
        const last = conv.turns.at(-1)?.text ?? "";
        const left = schemaMismatches(tryParseJSON(last, schema, { warn() {} }), schema);
        if (left.length > 0) {
          extraDegraded.push(`structured_output: the answer still did not match the declared output after one retry`);
        }
      }
      return tag(result);
    } catch (err) {
      const msg = `ACP agent run failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(msg);
      return tag({ status: "failed", data: { error: msg }, toolCalls: [] });
    } finally {
      await bridge?.close();
    }
  }

  /** Map one conversation onto a NodeResult with Claude Code's semantics. */
  private toResult(conv: Conversation, outputSchema: JSONSchema | undefined, timeoutMs?: number): NodeResult {
    const { toolCalls } = conv;
    const usage: NodeUsage | undefined = conv.costUsd !== undefined ? { costUsd: conv.costUsd } : undefined;
    const withUsage = (r: NodeResult): NodeResult => (usage ? { ...r, usage } : r);
    const last = conv.turns.at(-1)?.text ?? "";
    const fail = (error: string, partial = false): NodeResult => {
      this.logger.error(error);
      return withUsage({
        status: "failed",
        data: { error, ...(partial && last.trim() !== "" ? { summary: last.trim() } : {}) },
        toolCalls,
      });
    };

    if (conv.spawnError) return fail(`ACP agent could not start: ${conv.spawnError}`);
    if (conv.abortReason === "timeout") return fail(`ACP agent run timed out after ${timeoutMs}ms`);
    if (conv.abortReason === "signal") return fail("ACP agent run aborted");
    if (conv.overBudget) {
      // Same shape as Claude Code's max_turns stop: partial text is kept for fail_soft nodes.
      return fail(
        `ACP agent run terminated early: max_turns (${conv.overBudget.limit} tool calls; stopped by the sweny watchdog)`,
        true,
      );
    }
    if (conv.error) {
      const hint =
        conv.error.code === RPC_ERROR.authRequired
          ? ` (the agent wants you to sign in: pass its API key env var through SWENY_ENV_PASSTHROUGH, since sweny cannot run an interactive login)`
          : "";
      return fail(`ACP agent run failed: ${conv.error.message}${hint}`, true);
    }
    const turn = conv.turns.at(-1);
    if (!turn) {
      const code = conv.exitSignal ? `signal ${conv.exitSignal}` : `code ${conv.exitCode}`;
      const tail = conv.stderrTail.trim().split("\n").slice(-3).join(" | ");
      return fail(
        conv.exitCode === 0 && !conv.exitSignal
          ? `agent stream ended without a result message (${toolCalls.length} tool calls captured)`
          : `ACP agent exited with ${code}${tail ? `: ${tail}` : ""}`,
      );
    }
    if (turn.stopReason !== "end_turn") {
      return fail(`ACP agent stopped the turn early: ${turn.stopReason}`, true);
    }

    const parsed = tryParseJSON(last, outputSchema, this.logger, "ACP agent");
    return withUsage({ status: "success", data: { summary: last, ...parsed }, toolCalls });
  }

  /**
   * One completion: a fresh session with no MCP servers, every permission
   * request rejected, and any tool call over budget. null when it failed
   * (callers fail closed).
   */
  async complete(req: HarnessCompleteRequest): Promise<string | null> {
    const purpose = req.purpose ?? "ask";
    const failClosed = (why: string): null => {
      this.logger.warn(
        purpose === "evaluate"
          ? `acp.evaluate: ${why}. Failing closed (no route decision).`
          : `acp.ask: ${why}. Returning empty string.`,
      );
      return null;
    };
    const pre = await this.preflight();
    if (!pre.ok) return failClosed(pre.reason);

    // A judge call is a dry run with nothing allowed: same gate, same wrapper.
    const mode: SandboxMode = resolveSandboxMode(process.env, this.sandboxMode, this.logger);
    const policy: NodePolicy = {
      readOnly: true,
      // Nothing to deny at the gate: there is no MCP server and every permission request is rejected below.
      deny: [],
      egress: [],
      strict: this.policyMode === "strict",
      sandbox: mode,
    };
    const wrapper =
      mode !== "off" && this.sandboxWrapper !== null
        ? (this.sandboxWrapper ?? (await defaultSandboxWrapper()).wrapper)
        : undefined;
    const prep = await prepareAgentSpawn({
      caps: this.capabilities,
      policy,
      spawn: { command: this.agent.command, args: this.agent.args, env: this.buildEnv(), cwd: this.cwd },
      wrapper: wrapper ?? null,
      harnessEgress: this.egress,
      env: process.env,
    });
    if (prep.refuse) {
      await prep.cleanup();
      return failClosed(prep.refuse);
    }
    let conv: Conversation;
    try {
      conv = await this.converse({
        spawn: prep.spawn,
        cwd: this.cwd,
        mcpServers: {},
        prompt: req.prompt,
        readOnly: true,
        deny: new Set<ToolClass>(TOOL_CLASSES),
        skillTools: [],
        timeoutMs: req.timeoutMs,
        signal: req.signal,
        // Classification calls use no tools; any tool call is over budget.
        maxToolCalls: 0,
      });
    } finally {
      await prep.cleanup();
    }
    if (conv.agentVersion) this.agentVersion = conv.agentVersion;
    if (conv.spawnError) return failClosed(`the ACP agent could not start: ${conv.spawnError}`);
    if (conv.abortReason === "timeout") return failClosed(`timed out after ${req.timeoutMs}ms`);
    if (conv.abortReason === "signal") return failClosed("aborted");
    if (conv.overBudget) return failClosed("the model tried to call a tool");
    if (conv.error) return failClosed(`the ACP agent failed: ${conv.error.message}`);
    const turn = conv.turns.at(-1);
    if (!turn) return failClosed("agent stream ended without a result message");
    if (turn.stopReason !== "end_turn") return failClosed(`the ACP agent stopped the turn early: ${turn.stopReason}`);
    return turn.text;
  }
}
