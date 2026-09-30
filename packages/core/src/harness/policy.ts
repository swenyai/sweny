/**
 * policyGate: the one place that decides "degrade" versus "refuse".
 *
 * Pure. Called before every harness run. For Claude Code every opinion is
 * enforced natively, so the result is always `{ degraded: [] }`.
 */

import type { HarnessCapabilities, NodePolicy, PolicyGateResult, PolicyWrappers } from "./types.js";

export function policyGate(
  caps: HarnessCapabilities,
  policy: NodePolicy,
  wrappers: PolicyWrappers = {},
): PolicyGateResult {
  const degraded: string[] = [];

  if (policy.readOnly && caps.readOnly === "none" && !wrappers.readOnlyMount) {
    degraded.push("read-only: harness cannot enforce it and no read-only mount is active");
  }

  if (policy.deny.length > 0) {
    if (caps.builtinDeny === "none") {
      degraded.push(`deny [${policy.deny.join(", ")}]: harness cannot deny built-in tools`);
    } else if (caps.builtinDeny === "shell-only") {
      const unmappable = policy.deny.filter((c) => c !== "shell");
      if (unmappable.length > 0) {
        degraded.push(`deny [${unmappable.join(", ")}]: harness can only deny the shell tool`);
      }
    }
  }

  if ((policy.nativeDeny?.length ?? 0) > 0 && caps.builtinDeny === "none") {
    degraded.push("disallowed_tools: harness cannot deny built-in tools");
  }

  if (policy.egress.length > 0 && !caps.sandbox.network && !wrappers.egress) {
    degraded.push("egress allowlist: harness has no network sandbox and no egress wrapper is active");
  }

  if (degraded.length > 0 && policy.strict) {
    return { degraded, refuse: `strict policy: ${degraded.join("; ")}` };
  }
  return { degraded };
}
