/**
 * The agent ids `--agent` / `coding-agent-provider` accept. Each one has an
 * adapter and a green contract suite; anything else is refused, so sweny never
 * runs one agent under another's name. No runtime imports (the CLI config and
 * the harness factory share it).
 */

export const SUPPORTED_AGENTS = ["claude", "codex"] as const;
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

/** `acp:<command>` (#416): any Agent Client Protocol agent, started with `<command>`. */
export type AcpAgentId = `acp:${string}`;

/** The command of an `acp:<command>` agent id (`"opencode acp"` for `acp:opencode acp`), or undefined when it is not one or the command is empty. */
export function parseAcpAgent(id: string): string | undefined {
  if (!id.startsWith("acp:")) return undefined;
  const command = id.slice("acp:".length).trim();
  return command === "" ? undefined : command;
}

export function isSupportedAgent(id: string): id is SupportedAgent | AcpAgentId {
  return (SUPPORTED_AGENTS as readonly string[]).includes(id) || parseAcpAgent(id) !== undefined;
}

/** The error for an agent id with no adapter. */
export function unsupportedAgentError(id: string): string {
  return (
    `Unsupported coding agent "${id}": supported agents are "claude" (headless Claude Code) ` +
    `and "codex" (Codex CLI). Remove --agent / coding-agent-provider or set it to one of them.`
  );
}
