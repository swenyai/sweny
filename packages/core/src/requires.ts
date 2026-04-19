// ─── Requires: pre-condition gate ───────────────────────────────────
//
// Evaluates `node.requires` BEFORE the LLM runs. Same path grammar and
// resolver as verify — the only differences are the data root (cross-node
// context map instead of result.data) and the error prefix.

import type { NodeRequires } from "./types.js";
import { checkOutputRequired, checkOutputMatches } from "./verify.js";

/**
 * Evaluate a node's `requires` block against the cross-node context map.
 * Returns null when all checks pass (or when `requires` is undefined),
 * otherwise a single concatenated failure string.
 */
export function evaluateRequires(requires: NodeRequires | undefined, context: Record<string, unknown>): string | null {
  if (!requires) return null;

  const hasRequiredChecks = requires.output_required && requires.output_required.length > 0;
  const hasMatchChecks = requires.output_matches && requires.output_matches.length > 0;

  if (!hasRequiredChecks && !hasMatchChecks) {
    return `requires failed:\n  - Requires block present but no checks declared`;
  }

  const failures: string[] = [];

  if (hasRequiredChecks) {
    const e = checkOutputRequired(requires.output_required!, context);
    if (e) failures.push(e);
  }
  if (hasMatchChecks) {
    const e = checkOutputMatches(requires.output_matches!, context);
    if (e) failures.push(e);
  }

  if (failures.length === 0) return null;
  return `requires failed:\n  - ${failures.join("\n  - ")}`;
}
