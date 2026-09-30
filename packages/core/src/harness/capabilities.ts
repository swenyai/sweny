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
 * - readOnly native: `--sandbox read-only` plus the shell, web search and
 *   subagent switches above.
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
