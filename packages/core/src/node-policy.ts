/**
 * Node permissions (#365): resolve what a node's agent may do.
 *
 * Pure and browser-safe. The workflow's `permissions` is both the default and
 * the ceiling for every node; a node may narrow it, never widen it.
 */

import type { NodePolicy, ToolClass } from "./harness/types.js";
import type { Node, NodeAccess, NodePermissions, NodePermissionsSpec, Workflow } from "./types.js";

export interface ResolvedPermissions {
  access: NodeAccess;
  deny: ToolClass[];
  strict: boolean;
}

function spec(p: NodePermissions | undefined): NodePermissionsSpec {
  if (p === undefined) return {};
  return typeof p === "string" ? { access: p } : p;
}

/**
 * Effective permissions for a node.
 *
 * access: the node's own, else `read` when it declares `outputs`, else the
 * workflow's, else `write` (today's behavior). A workflow `read` ceiling wins
 * over a node `write` (the loader rejects that combination; this is the
 * runtime backstop). deny: union. strict: either.
 */
export function resolveNodePermissions(
  node: Pick<Node, "permissions" | "outputs">,
  workflow: Pick<Workflow, "permissions"> = {},
): ResolvedPermissions {
  const wf = spec(workflow.permissions);
  const own = spec(node.permissions);
  let access: NodeAccess = own.access ?? (node.outputs && node.outputs.length > 0 ? "read" : (wf.access ?? "write"));
  if (wf.access === "read") access = "read";
  const deny = [...new Set<ToolClass>([...(wf.deny ?? []), ...(own.deny ?? [])])];
  return { access, deny, strict: wf.strict === true || own.strict === true };
}

/** True when a node asks for more than the workflow ceiling allows. */
export function exceedsPermissionCeiling(
  node: Pick<Node, "permissions">,
  workflow: Pick<Workflow, "permissions">,
): boolean {
  return spec(workflow.permissions).access === "read" && spec(node.permissions).access === "write";
}

/** The portable policy handed to the harness for one node run. */
export function buildNodePolicy(opts: {
  permissions: ResolvedPermissions;
  dryRun: boolean;
  disallowedTools?: string[];
  egress?: string[];
}): NodePolicy {
  return {
    readOnly: opts.dryRun || opts.permissions.access === "read",
    deny: opts.permissions.deny,
    ...(opts.disallowedTools && opts.disallowedTools.length > 0 ? { nativeDeny: opts.disallowedTools } : {}),
    egress: opts.egress ?? [],
    strict: opts.permissions.strict,
  };
}
