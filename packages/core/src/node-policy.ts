/**
 * Node permissions (#365): resolve what a node's agent may do.
 *
 * Pure and browser-safe. The workflow's `permissions` is both the default and
 * the ceiling for every node; a node may narrow it, never widen it.
 */

import type { NodePolicy, ToolClass } from "./harness/types.js";
import type { Node, NodeAccess, NodeNative, NodePermissions, NodePermissionsSpec, Workflow } from "./types.js";

export interface ResolvedPermissions {
  access: NodeAccess;
  deny: ToolClass[];
  strict: boolean;
  native?: NodeNative;
}

function spec(p: NodePermissions | undefined): NodePermissionsSpec {
  if (p === undefined) return {};
  return typeof p === "string" ? { access: p } : p;
}

/**
 * The access a node gets when neither it nor the workflow declares one (#598).
 * Spec v2 and later: `read`, safe by default. Spec v1, or no `spec_version` (a
 * workflow built in code, or one the loader did not migrate): `write`, the v1
 * behavior. The loader migrates v1 files to v2 with that `write` made explicit.
 */
export function defaultNodeAccess(workflow: Pick<Workflow, "spec_version"> = {}): NodeAccess {
  return Number(workflow.spec_version ?? "1") >= 2 ? "read" : "write";
}

/**
 * True when the node runs under a declared policy: its own or the workflow's
 * `permissions`, its `outputs`, or the spec v2 `read` default. A node that runs
 * under none keeps each harness's own defaults (spec v1 only).
 */
export function hasNodePolicy(
  node: Pick<Node, "permissions" | "outputs">,
  workflow: Pick<Workflow, "permissions" | "spec_version"> = {},
): boolean {
  return (
    node.permissions !== undefined ||
    workflow.permissions !== undefined ||
    (node.outputs?.length ?? 0) > 0 ||
    defaultNodeAccess(workflow) === "read"
  );
}

/**
 * Effective permissions for a node.
 *
 * access: the node's own, else `read` when it declares `outputs`, else the
 * workflow's, else {@link defaultNodeAccess} (`read` from spec v2, `write` in
 * v1). A workflow `read` ceiling wins over a node `write` (the loader rejects
 * that combination; this is the runtime backstop). deny: union. strict:
 * either. native: `none` if either says so.
 */
export function resolveNodePermissions(
  node: Pick<Node, "permissions" | "outputs">,
  workflow: Pick<Workflow, "permissions" | "spec_version"> = {},
): ResolvedPermissions {
  const wf = spec(workflow.permissions);
  const own = spec(node.permissions);
  let access: NodeAccess =
    own.access ?? (node.outputs && node.outputs.length > 0 ? "read" : (wf.access ?? defaultNodeAccess(workflow)));
  if (wf.access === "read") access = "read";
  const deny = [...new Set<ToolClass>([...(wf.deny ?? []), ...(own.deny ?? [])])];
  const none = wf.native === "none" || own.native === "none";
  return {
    access,
    deny,
    strict: wf.strict === true || own.strict === true,
    ...(none ? { native: "none" as const } : {}),
  };
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
    ...(opts.permissions.strict ? { exclusiveMcp: true } : {}),
    ...(opts.permissions.native === "none" ? { nativeNone: true } : {}),
  };
}
