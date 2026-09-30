/**
 * The agent ids `--agent` / `coding-agent-provider` accept. Each one has an
 * adapter and a green contract suite; anything else is refused, so sweny never
 * runs one agent under another's name. No runtime imports (the CLI config and
 * the harness factory share it).
 */

export const SUPPORTED_AGENTS = ["claude", "codex"] as const;
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

export function isSupportedAgent(id: string): id is SupportedAgent {
  return (SUPPORTED_AGENTS as readonly string[]).includes(id);
}

/** The error for an agent id with no adapter. */
export function unsupportedAgentError(id: string): string {
  return (
    `Unsupported coding agent "${id}": supported agents are "claude" (headless Claude Code) ` +
    `and "codex" (Codex CLI). Remove --agent / coding-agent-provider or set it to one of them.`
  );
}
