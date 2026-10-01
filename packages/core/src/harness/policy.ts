/**
 * policyGate: the one place that decides "degrade" versus "refuse".
 *
 * Pure. Called before every harness run. For Claude Code every opinion is
 * enforced natively, so the result is always `{ degraded: [] }`. A harness
 * without a native sandbox is covered by a process wrapper when the host has
 * one (`wrappers`; see `prepareAgentSpawn` in sandbox-wrapper.ts).
 *
 * Two kinds of `degraded` entry:
 * - unenforced: nobody enforces the opinion (the harness cannot, and no host
 *   wrapper is active). Strict mode refuses the node on these.
 * - wrapped: sweny keeps the opinion itself, but not natively (for example a
 *   watchdog in place of a native turn limit). Reported, never refused.
 */

import type { SpendLimits } from "../budget.js";
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
  // A read-only mount stops file writes, not API writes: an agent that holds a
  // write credential and can reach the network can still change remote state
  // without asking (security review 2026-09-30, finding 1).
  const held = policy.agentCredentials ?? [];
  if (policy.readOnly && caps.readOnly === "none" && held.length > 0) {
    unenforced.push(
      `read-only: the agent process holds write credentials (${held.join(", ")}) and network access; ` +
        `a read-only filesystem mount does not stop API writes`,
    );
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

  // Exclusive MCP (`permissions.strict`): only the servers sweny passes may
  // load, never the user's own config. A harness that cannot exclude them
  // cannot honor it, so strict refuses the node.
  if (policy.exclusiveMcp && caps.mcp.exclusive === "none") {
    unenforced.push("exclusive MCP: harness cannot keep the user's own MCP servers out of the run");
  }

  if (policy.egress.length > 0 && !caps.sandbox.network && !wrappers.egress) {
    unenforced.push("egress allowlist: harness has no network sandbox and no egress wrapper is active");
  }

  const sandboxMode = policy.sandbox ?? "off";
  // #442 + finding 3: a staged write node's push block is env and git hooks.
  // Only fs and network containment stops a deliberate agent from undoing it.
  if (policy.stagedWrite) {
    const contained = sandboxMode !== "off" && ((caps.sandbox.fs && caps.sandbox.network) || wrappers.sandbox === true);
    if (!contained) {
      unenforced.push(
        "no push (staged run): blocked by env and git hooks only; with no sandbox a deliberate agent can undo them and push",
      );
    }
  }
  let sandboxGap: string | undefined;
  if (sandboxMode !== "off" && !(caps.sandbox.fs && caps.sandbox.network) && !wrappers.sandbox) {
    sandboxGap = "sandbox: harness has no native fs and network sandbox and no process sandbox wrapper is available";
    unenforced.push(sandboxGap);
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
  if (sandboxGap && sandboxMode === "strict") {
    return {
      degraded,
      refuse:
        `strict sandbox (SWENY_SANDBOX=strict): ${sandboxGap}. Install srt ` +
        `(npm i -g @anthropic-ai/sandbox-runtime, plus bubblewrap, socat and ripgrep on Linux), ` +
        `or set SWENY_SANDBOX=auto to run with a warning.`,
    };
  }
  return { degraded };
}

/**
 * budgetGate (#449): can this harness keep a spend budget? Pure; the executor
 * calls it once per node that has a token or cost limit (node or run).
 *
 * Per budgeted unit:
 * - the harness cannot report the unit at all (Codex has no cost): nothing can
 *   be enforced. Reported as `budget_<unit>`; `strict` refuses the node.
 * - the harness reports it only when the node ends: enforced between nodes, so
 *   one node can overrun before it is stopped. Reported as `budget_live`,
 *   never refused.
 */
export function budgetGate(caps: HarnessCapabilities, limits: SpendLimits, strict: boolean): PolicyGateResult {
  const unenforced: string[] = [];
  const wrapped: string[] = [];
  const units = [
    { unit: "tokens", key: "tokens", limit: limits.tokens, reports: caps.usage.tokens },
    { unit: "cost_usd", key: "costUsd", limit: limits.costUsd, reports: caps.usage.costUsd },
  ] as const;
  const notLive: string[] = [];
  for (const u of units) {
    if (u.limit === undefined) continue;
    if (!u.reports) {
      unenforced.push(
        `budget_${u.unit}: harness cannot report ${u.unit === "tokens" ? "token" : "cost"} usage, so this budget is not enforced`,
      );
    } else if (!caps.usage.live || (caps.usage.liveUnits !== undefined && !caps.usage.liveUnits.includes(u.key))) {
      notLive.push(u.unit);
    }
  }
  if (notLive.length > 0) {
    wrapped.push(
      `budget_live: harness reports ${notLive.join(" and ")} only when a node ends; the budget is enforced between nodes, so a node can overrun before it is stopped`,
    );
  }
  const degraded = [...unenforced, ...wrapped];
  if (unenforced.length > 0 && strict) return { degraded, refuse: `strict policy: ${unenforced.join("; ")}` };
  return { degraded };
}
