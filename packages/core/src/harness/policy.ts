/**
 * policyGate: the one place that decides "degrade" versus "refuse".
 *
 * Pure. Called before every harness run. For Claude Code every opinion is
 * enforced natively, so the result is always `{ degraded: [] }`.
 *
 * Two kinds of `degraded` entry:
 * - unenforced: nobody enforces the opinion (the harness cannot, and no host
 *   wrapper is active). Strict mode refuses the node on these.
 * - wrapped: sweny keeps the opinion itself, but not natively (for example a
 *   watchdog in place of a native turn limit). Reported, never refused.
 */

import type { HarnessCapabilities, NodePolicy, PolicyGateResult, PolicyWrappers, ToolClass } from "./types.js";

/** `strict` refuses a node whose opinions the harness cannot honor; `warn` runs it and reports `degraded`. */
export type HarnessPolicyMode = "strict" | "warn";

/**
 * Resolve the harness policy mode: the explicit value (`--harness-policy`),
 * else `SWENY_HARNESS_POLICY`, else `strict` under GitHub Actions and `warn`
 * everywhere else. An unknown value warns and uses that default.
 */
export function resolveHarnessPolicy(
  env: Record<string, string | undefined>,
  explicit?: string,
  logger?: { warn(msg: string): void },
): HarnessPolicyMode {
  const fallback: HarnessPolicyMode = env.GITHUB_ACTIONS === "true" ? "strict" : "warn";
  const raw = (explicit ?? env.SWENY_HARNESS_POLICY ?? "").trim().toLowerCase();
  if (raw === "strict" || raw === "warn") return raw;
  if (raw !== "") logger?.warn(`harness policy "${raw}" is not one of strict|warn; using ${fallback}`);
  return fallback;
}

/** Every portable tool class, in a stable order. */
export const TOOL_CLASSES: readonly ToolClass[] = ["shell", "write", "edit", "net", "subagent"];

/** Is `name` a portable tool class (`tools.deny: [write]`)? */
export function isToolClass(name: string): name is ToolClass {
  return (TOOL_CLASSES as readonly string[]).includes(name);
}

/** The tool classes a harness can deny natively. */
export function nativeDenyClasses(caps: HarnessCapabilities): ToolClass[] {
  const base: readonly ToolClass[] =
    caps.builtinDeny === "by-name" || caps.builtinDeny === "by-class"
      ? TOOL_CLASSES
      : caps.builtinDeny === "shell-only"
        ? ["shell"]
        : [];
  const set = new Set<ToolClass>([...base, ...(caps.denyClasses ?? [])]);
  return TOOL_CLASSES.filter((c) => set.has(c));
}

export function policyGate(
  caps: HarnessCapabilities,
  policy: NodePolicy,
  wrappers: PolicyWrappers = {},
): PolicyGateResult {
  const unenforced: string[] = [];
  const wrapped: string[] = [];

  if (policy.readOnly && caps.readOnly === "none" && !wrappers.readOnlyMount) {
    unenforced.push("read-only: harness cannot enforce it and no read-only mount is active");
  }

  if (policy.deny.length > 0) {
    const native = nativeDenyClasses(caps);
    const unmappable = policy.deny.filter((c) => !native.includes(c));
    if (unmappable.length > 0) {
      const list = unmappable.join(", ");
      if (native.length === 0) {
        unenforced.push(`deny [${list}]: harness cannot deny built-in tools`);
      } else if (native.length === 1 && native[0] === "shell") {
        unenforced.push(`deny [${list}]: harness can only deny the shell tool`);
      } else {
        unenforced.push(`deny [${list}]: harness can only deny [${native.join(", ")}]`);
      }
    }
  }

  if ((policy.nativeDeny?.length ?? 0) > 0) {
    if (caps.builtinDeny === "none") {
      unenforced.push("disallowed_tools: harness cannot deny built-in tools");
    } else if (caps.builtinDeny !== "by-name") {
      // Only a by-name harness can take tool names verbatim. Adapters translate
      // the names they know into classes first; what is left is unenforced.
      unenforced.push(`disallowed_tools [${policy.nativeDeny!.join(", ")}]: harness has no tools by these names`);
    }
  }

  if (policy.egress.length > 0 && !caps.sandbox.network && !wrappers.egress) {
    unenforced.push("egress allowlist: harness has no network sandbox and no egress wrapper is active");
  }

  if (policy.maxTurns !== undefined && caps.turnLimit !== "native") {
    if (caps.turnLimit === "watchdog") {
      wrapped.push(`max_turns: no native turn limit; sweny stops the run after ${policy.maxTurns} tool calls`);
    } else {
      unenforced.push("max_turns: harness has no turn limit and no watchdog");
    }
  }

  const degraded = [...unenforced, ...wrapped];
  if (unenforced.length > 0 && policy.strict) {
    return { degraded, refuse: `strict policy: ${unenforced.join("; ")}` };
  }
  return { degraded };
}
