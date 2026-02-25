/**
 * Tools that are always denied. These are irreversible or high-risk mutations.
 * The system prompt also instructs Claude to refuse writes,
 * and the DB tool layer has built-in read-only enforcement.
 * This list is an additional hard guardrail.
 *
 * Note: Bash, Write, and Edit are allowed so the agent can execute scripts
 * and process data in /tmp. The runner sets cwd="/tmp" and in k8s the FS
 * is immutable outside /tmp, so this is safe.
 */
export const DENIED_TOOLS: string[] = [
  "NotebookEdit",
];

/**
 * Tools that would require user confirmation before execution (future phase).
 * For now, these are handled by the system prompt's read-only instruction.
 */
export const CONFIRMATION_REQUIRED_TOOLS: string[] = [
  // Phase 2+: these would pause and ask the user for confirmation
];
