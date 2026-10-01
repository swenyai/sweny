/**
 * Declared capabilities per adapter. No runtime imports, so the executor can use
 * them without pulling in an agent SDK.
 */

import type { HarnessCapabilities } from "./types.js";

/**
 * Claude Code enforces every sweny opinion natively, so `policyGate` never degrades or refuses it.
 * usage: tokens live (per assistant message, a lower bound until the terminal
 * `result` message gives the authoritative total); cost only at the end of the
 * node (the SDK prices the run in `total_cost_usd` on `result`).
 */
export const CLAUDE_CODE_CAPABILITIES: HarnessCapabilities = {
  structuredOutput: "native",
  toolTrace: "full",
  builtinDeny: "by-name",
  mcp: { inject: true, exclusive: "native" },
  sandbox: { fs: true, network: true },
  readOnly: "native",
  turnLimit: "native",
  usage: { tokens: true, costUsd: true, live: true, liveUnits: ["tokens"] },
  cancel: "signal",
  resume: false,
};

/**
 * Codex (`codex exec --json`), declared from the openai/codex source at
 * rust-v0.159.2 and probed by the contract suite against the scripted fake:
 * - structuredOutput native: `--output-schema <file>` (exec/src/cli.rs).
 * - toolTrace full: `item.*` events for command_execution, file_change,
 *   mcp_tool_call and web_search, each with an id and a status
 *   (exec/src/exec_events.rs).
 * - builtinDeny shell-only, plus net and subagent: `features.shell_tool=false`
 *   removes every shell tool (core/src/tools/spec_plan.rs add_shell_tools),
 *   `web_search="disabled"` removes web search, and `features.multi_agent=false`
 *   with `agents.enabled=false` removes subagents. apply_patch has no switch,
 *   so write and edit cannot be denied as classes.
 * - mcp exclusive native: `--ignore-user-config` drops `$CODEX_HOME/config.toml`,
 *   and project `.codex/config.toml` layers stay disabled for a project that
 *   is not trusted in that ignored file (config/src/loader/mod.rs).
 * - sandbox fs only: `--sandbox read-only|workspace-write`. Network is one
 *   on/off switch (`sandbox_workspace_write.network_access`), not a host list.
 * - readOnly native: `--sandbox read-only` plus the web search and subagent
 *   switches above. The shell stays: Codex has no other way to read a file, and
 *   the OS sandbox (SandboxPolicy::ReadOnly, network off by default,
 *   protocol/src/protocol.rs) blocks writes and network from it. An explicit
 *   `tools.deny: [shell]` still removes it.
 * - turnLimit watchdog: codex exec has no turn limit; sweny counts tool calls.
 * - usage tokens only: `turn.completed.usage`; Codex reports no cost.
 */
export const CODEX_CAPABILITIES: HarnessCapabilities = {
  structuredOutput: "native",
  toolTrace: "full",
  builtinDeny: "shell-only",
  denyClasses: ["shell", "net", "subagent"],
  mcp: { inject: true, exclusive: "native" },
  sandbox: { fs: true, network: false },
  readOnly: "native",
  turnLimit: "watchdog",
  usage: { tokens: true, costUsd: false, live: false },
  cancel: "kill",
  resume: false,
};

/**
 * pi (`pi --mode rpc`), declared from the pi coding-agent docs and source at
 * badlogic/pi-mono v0.99.2 (`packages/coding-agent/docs/{cli,rpc,rpc-commands,json,mcp,
 * security,message-types}.md`, `src/core/agent-session.ts`, `src/extensions/mcp/`)
 * and probed by the contract suite against the scripted fake:
 * - structuredOutput prompt: pi has no output-schema flag; sweny prompts for
 *   the JSON, parses and validates it.
 * - toolTrace full: `tool_execution_start|end` events carry `toolCallId`,
 *   `toolName`, `args`, `isError` for built-in and MCP tools alike.
 * - builtinDeny shell-only, plus write, edit and subagent: `--exclude-tools` and
 *   `--tools` take tool names (`bash`, `write`, `edit`), and `-ne` leaves no
 *   extension, so no subagent tool exists. pi has no built-in net tool, so `net`
 *   is not deniable as a class (`bash` can still curl): it degrades or, in
 *   strict, refuses.
 * - mcp home-isolation: MCP is a built-in extension that reads `mcp.json` from
 *   `$PI_CODING_AGENT_DIR`. sweny points that at a scratch dir holding only the
 *   generated `mcp.json`, and passes `-na` so a project `.pi/mcp.json` never loads.
 * - sandbox none: "no built-in sandbox" (docs/security.md). The process wrapper
 *   (sandbox-wrapper.ts) is the only containment; strict refuses without it.
 * - readOnly tool-allowlist: `--tools read,grep,find,ls` plus sweny's own MCP
 *   tools; no shell, write or edit tool exists in the run.
 * - turnLimit watchdog: pi has no turn limit flag; sweny counts
 *   `tool_execution_start` events and aborts.
 * - usage tokens and cost: `get_session_stats` returns tokens and cost for the
 *   session. Read once at the end, so `live` is false.
 * - cancel rpc: the `abort` command, then SIGTERM and SIGKILL.
 */
export const PI_CAPABILITIES: HarnessCapabilities = {
  structuredOutput: "prompt",
  toolTrace: "full",
  builtinDeny: "shell-only",
  denyClasses: ["shell", "write", "edit", "subagent"],
  mcp: { inject: true, exclusive: "home-isolation" },
  sandbox: { fs: false, network: false },
  readOnly: "tool-allowlist",
  turnLimit: "watchdog",
  usage: { tokens: true, costUsd: true, live: false },
  cancel: "rpc",
  resume: false,
};

/**
 * Any ACP agent (`--agent acp:<command>`, #416), declared from the Agent
 * Client Protocol schema v1.24.1 (agentclientprotocol/agent-client-protocol,
 * `schema/v1/schema.json`, docs under `docs/protocol/v1/`) and probed by the
 * contract suite against a scripted fake agent. ACP is the long-tail adapter:
 * the protocol carries a prompt and a stream of updates, not sweny's opinions.
 * - structuredOutput prompt: `PromptResponse` has only `stopReason`, so there
 *   is no schema channel. sweny asks for the JSON in the prompt, parses it,
 *   checks it and retries once.
 * - toolTrace full: `tool_call` and `tool_call_update` session updates carry an
 *   id, a kind, a status and (optionally) raw input and content.
 * - builtinDeny none: the protocol has no tool allow or deny list. The only
 *   hook is `session/request_permission`, which fires only when the agent
 *   chooses to ask. sweny answers it by policy (best effort), but cannot
 *   promise the agent asks, so nothing is declared.
 * - mcp inject, exclusive none: `session/new` takes `mcpServers`, but whether
 *   the agent also loads its own MCP config is agent-defined.
 * - sandbox none: nothing in the protocol. The process wrapper (srt) is the
 *   only containment, see sandbox-wrapper.ts.
 * - readOnly none: modes are agent-defined. `policyGate` counts read-only as
 *   enforced only with the wrapper's read-only mount.
 * - turnLimit watchdog: no turn limit in the protocol; sweny counts tool calls.
 * - usage costUsd only, live: `usage_update {used, size, cost?}` is the stable
 *   usage and arrives while the turn runs, so a cost budget stops the agent
 *   mid-node. `used` and `size` are context window occupancy, not billed
 *   tokens, so they are not mapped; `cost` (cumulative, ISO 4217 currency) is, when it
 *   is USD. Per-turn token usage is behind an unstable flag.
 * - cancel rpc: `session/cancel`, then kill.
 * - resume false: sweny starts a fresh session per node.
 */
export const ACP_CAPABILITIES: HarnessCapabilities = {
  structuredOutput: "prompt",
  toolTrace: "full",
  builtinDeny: "none",
  mcp: { inject: true, exclusive: "none" },
  sandbox: { fs: false, network: false },
  readOnly: "none",
  turnLimit: "watchdog",
  usage: { tokens: false, costUsd: true, live: true, liveUnits: ["costUsd"] },
  cancel: "rpc",
  resume: false,
};
