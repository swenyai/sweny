/**
 * Map nodes (spec v3, RFC 0002 M1, #575): the static half.
 *
 * A `kind: map` node runs one complete child SWEny run per item. This module
 * holds what the loader and `validateWorkflow` need: the derived output
 * schema, the child workflow a map node runs, and the load-time checks. The
 * runtime (pool, slots, cancellation, the shared tally) is `map.ts`.
 *
 * Pure module: no I/O, browser-safe.
 */

import type { JSONSchema, Node, NodePermissions, Workflow } from "./types.js";
import { MAP_INDEX_KEY, MAP_ITEM_KEY_PATTERN, MAP_MAX_ITEMS_DEFAULT, MAP_CONCURRENCY_DEFAULT } from "./types.js";

/** True for a `kind: map` node. */
export function isMapNode(node: Pick<Node, "kind"> | undefined): boolean {
  return node?.kind === "map";
}

/**
 * The output every map node declares, derived (#575): `items` keyed by item
 * key (`{status, data}` each), `order` (the keys in input order), `results`
 * (each item's `result:` output in input order, null for an item that did not
 * succeed) and `counts`. `when` expressions and `requires` paths validate
 * against it at load.
 */
export const MAP_OUTPUT_SCHEMA: JSONSchema = {
  type: "object",
  required: ["items", "order", "results", "counts"],
  properties: {
    items: { type: "object" },
    order: { type: "array", items: { type: "string" } },
    results: { type: "array" },
    counts: {
      type: "object",
      required: ["total", "success", "failed", "skipped", "cancelled"],
      properties: {
        total: { type: "integer" },
        success: { type: "integer" },
        failed: { type: "integer" },
        skipped: { type: "integer" },
        cancelled: { type: "integer" },
      },
    },
  },
};

/** A copy of `workflow` whose map nodes declare {@link MAP_OUTPUT_SCHEMA}. Unchanged when it has none. */
export function withMapOutputs<W extends Pick<Workflow, "nodes">>(workflow: W): W {
  const ids = Object.keys(workflow.nodes).filter((id) => isMapNode(workflow.nodes[id]));
  if (ids.length === 0) return workflow;
  const nodes = { ...workflow.nodes };
  for (const id of ids) nodes[id] = { ...nodes[id], output: MAP_OUTPUT_SCHEMA };
  return { ...workflow, nodes };
}

/** A read-only ceiling over a declared workflow `permissions`: what every child runs under in M1. */
function readOnlyCeiling(p: NodePermissions | undefined): NodePermissions {
  if (p === undefined || typeof p === "string") return "read";
  return { ...p, access: "read" };
}

/**
 * The workflow a map node runs per item, as a complete Workflow: its id is
 * `<parent id>.<node id>` unless the child file declares one, its name the
 * node's, its spec version its own (a file) or the parent's (inline). Inline
 * skills of the parent are visible to it. Its `permissions` are a read
 * ceiling: children are read-only in M1. Undefined while `workflow` is still
 * a file path the loader has not read.
 */
export function childWorkflowOf(parent: Workflow, nodeId: string): Workflow | undefined {
  const node = parent.nodes[nodeId];
  const child = node?.workflow;
  if (!child || typeof child === "string") return undefined;
  const skills = parent.skills || child.skills ? { ...(parent.skills ?? {}), ...(child.skills ?? {}) } : undefined;
  const spec = child.spec_version ?? parent.spec_version;
  const model = child.model ?? parent.model;
  return {
    ...child,
    id: child.id ?? `${parent.id}.${nodeId}`,
    name: child.name ?? node.name,
    description: child.description ?? "",
    ...(spec !== undefined ? { spec_version: spec } : {}),
    ...(skills ? { skills } : {}),
    ...(model !== undefined ? { model } : {}),
    permissions: readOnlyCeiling(child.permissions),
  };
}

/** Segments of a map path (`input.todos`, `list.items`), or undefined when it is not one. */
export function mapPathSegments(path: string): string[] | undefined {
  const segs = path.split(".");
  if (segs.length < 2 || segs.some((s) => s.length === 0)) return undefined;
  return segs;
}

/** Child inputs a `with:` entry may not name: the map sets them itself. */
const RESERVED_WITH = new Set(["item", "item_key"]);
const WITH_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ITEM_FIELD = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * The load-time problems of one map node (child workflow problems excluded:
 * `validateWorkflow` checks the child as a workflow of its own). Each is one
 * line naming the node.
 */
export function mapNodeProblems(workflow: Workflow, nodeId: string, specVersion: number): string[] {
  const node = workflow.nodes[nodeId];
  const out: string[] = [];
  const say = (m: string) => out.push(`Map node "${nodeId}" ${m}`);
  if (specVersion < 3) say(`needs spec_version "3"; this workflow runs as spec_version "${specVersion}"`);
  const hasOver = node.over !== undefined;
  const hasItems = node.items !== undefined;
  if (hasOver === hasItems) say("must declare exactly one of `over` (a path to an array) and `items` (a literal list)");
  const checkPath = (field: string, path: string) => {
    const segs = mapPathSegments(path);
    if (!segs) {
      say(`${field} "${path}" is not a path: write input.<field> or <node>.<field>`);
      return;
    }
    const root = segs[0];
    if (root === "input") return;
    if (root === nodeId) {
      say(`${field} "${path}" reads the map node's own output`);
      return;
    }
    const src = workflow.nodes[root];
    if (!src) {
      say(`${field} "${path}" names node "${root}", which this workflow does not have`);
      return;
    }
    const props = (src.output as { properties?: Record<string, unknown> } | undefined)?.properties;
    if (src.kind !== "map" && props && typeof props === "object" && !(segs[1] in props)) {
      say(`${field} "${path}" reads ${root}.${segs[1]}, which node "${root}" does not declare in its output`);
    }
  };
  if (typeof node.over === "string") checkPath("over", node.over);
  const max = node.max_items ?? MAP_MAX_ITEMS_DEFAULT;
  if (Array.isArray(node.items) && node.items.length > max) {
    say(`lists ${node.items.length} items, more than max_items (${max})`);
  }
  if (node.key !== undefined && node.key !== MAP_INDEX_KEY && !ITEM_FIELD.test(node.key)) {
    say(`key "${node.key}" must be an item field name or ${MAP_INDEX_KEY}`);
  }
  if (Array.isArray(node.items) && node.key !== undefined) {
    const keys = node.items.map((item, i) => itemKeyOf(item, i, node.key!));
    const bad = keys.find((k): k is { error: string } => typeof k !== "string");
    if (bad !== undefined) say(bad.error);
    else {
      const seen = new Set<string>();
      for (const k of keys as string[]) {
        if (seen.has(k)) say(`has two items with key "${k}"; keys must be unique`);
        seen.add(k);
      }
    }
  }
  for (const [name, path] of Object.entries(node.with ?? {})) {
    if (!WITH_NAME.test(name) || RESERVED_WITH.has(name)) {
      say(`with: "${name}" is not a child input name (letters, digits, _; not item or item_key)`);
    }
    checkPath(`with.${name}`, path);
  }
  if (typeof node.min_success === "number" && (node.on_item_fail ?? "fail_fast") !== "collect") {
    say("sets min_success, which needs on_item_fail: collect");
  }
  const items = Array.isArray(node.items) ? node.items.length : undefined;
  if (typeof node.min_success === "number" && items !== undefined && node.min_success > items) {
    say(`needs ${node.min_success} successes but lists ${items} items`);
  }
  if (typeof node.workflow === "string") {
    say(`names the workflow file "${node.workflow}", which was not read: load the workflow from its file`);
  } else if (node.workflow) {
    const child = node.workflow;
    if (node.result !== undefined && !child.nodes?.[node.result]) {
      say(`result "${node.result}" is not a node of its child workflow`);
    }
    for (const [id, n] of Object.entries(child.nodes ?? {})) {
      if (n.kind === "map") say(`runs a child workflow with a map node ("${id}"); nested maps are not supported`);
      // Child write requests (#576) go up to the map, which plans them per item; only when
      // every item runs (collect), so one failure cannot leave a half-written batch to chance.
      if ((n.outputs?.length ?? 0) > 0 && (node.on_item_fail ?? "fail_fast") !== "collect") {
        say(`runs a child workflow whose node "${id}" declares outputs, which needs on_item_fail: collect`);
      }
      if (declaresWrite(n.permissions)) {
        say(`runs a child workflow whose node "${id}" declares write permissions; children are read-only in M1`);
      }
    }
    if (declaresWrite(child.permissions)) {
      say("runs a child workflow that declares write permissions; children are read-only in M1");
    }
  }
  return out;
}

function declaresWrite(p: NodePermissions | undefined): boolean {
  return p === "write" || (typeof p === "object" && p !== null && p.access === "write");
}

/**
 * The key of one item: its `key` field (a string or an integer, as text), or
 * its index for `$index`. An error when the field is missing or the key does
 * not match `[A-Za-z0-9_-]{1,64}`.
 */
export function itemKeyOf(item: unknown, index: number, key: string): string | { error: string } {
  if (key === MAP_INDEX_KEY) return String(index);
  const v =
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>)[key]
      : undefined;
  const text = typeof v === "string" ? v : typeof v === "number" && Number.isInteger(v) ? String(v) : undefined;
  if (text === undefined) return { error: `item ${index} has no string or integer "${key}" to key it by` };
  if (!MAP_ITEM_KEY_PATTERN.test(text)) {
    return { error: `item ${index} key "${text}" must match ${MAP_ITEM_KEY_PATTERN.source}` };
  }
  return text;
}

/** Effective concurrency and item cap of a map node (defaults filled in). */
export function mapLimits(node: Node): { concurrency: number; maxItems: number } {
  return {
    concurrency: node.concurrency ?? MAP_CONCURRENCY_DEFAULT,
    maxItems: node.max_items ?? MAP_MAX_ITEMS_DEFAULT,
  };
}
