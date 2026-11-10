/**
 * Map nodes (spec v3, RFC 0002 M1, #575): the runtime half.
 *
 * A map visit runs one complete child SWEny run per item through an injected
 * {@link ChildRunHost}. The host owns where a child's journal lives and which
 * generation it is (slots, generations, resume); this file owns the item
 * list, the logical ids, the lifecycle decision and the pool.
 *
 * Harness-neutral and skill-neutral: hosts inject journals and harnesses;
 * nothing here names a harness or a skill.
 */

import crypto from "node:crypto";
import pLimit from "p-limit";

import type { AgentHarness } from "./harness/types.js";
import { canonicalHash, workflowHashOf, type ChildRegistration, type ExecutionJournal } from "./journal.js";
import type { ExecutionResult, Logger, MapItemStatus, Node, NodeResult, Observer, Workflow } from "./types.js";
import { MAP_INDEX_KEY } from "./types.js";
import { itemKeyOf, mapLimits, mapPathSegments } from "./map-spec.js";
import { checkOutputContract, contractFailureMessage } from "./output-contract.js";

/** One child of one map visit. */
export interface ChildRunRef {
  /** The parent run's id. */
  parentRun: string;
  /** The map node. */
  node: string;
  /** The map visit's iteration. */
  iteration: number;
  /** The item's key. */
  key: string;
  /** The item's position in the input. */
  index: number;
  /** `<parent run>/<map node>#<iteration>/<item key>`: the child's identity across generations. */
  logicalId: string;
  /** `sha256(logicalId)[:16]`: the slot directory that holds its generations. */
  slot: string;
  /** Hash of the visit's items, as registered on the map visit's `node:start`. */
  itemsHash: string;
  /** Hash of the child workflow. */
  workflowHash: string;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** The ref of one child: its logical id and slot follow from the parent run, the visit and the key. */
export function childRef(
  parentRun: string,
  node: string,
  iteration: number,
  key: string,
  index: number,
  itemsHash: string,
  workflowHash: string,
): ChildRunRef {
  const logicalId = `${parentRun}/${node}#${iteration}/${key}`;
  return {
    parentRun,
    node,
    iteration,
    key,
    index,
    logicalId,
    slot: sha256(logicalId).slice(0, 16),
    itemsHash,
    workflowHash,
  };
}

/** A generation's run id: the logical id and the generation number. */
export function generationRunId(ref: Pick<ChildRunRef, "logicalId">, generation: number): string {
  return `${ref.logicalId}@g${generation}`;
}

/**
 * What a slot's latest generation shows:
 * - `empty`: created, nothing journaled (head at seq 0, or not even that), so nothing was spent;
 * - `unfinished`: no `run:end` (a crash, or a cancel: a cancelled child is detached), or `run:end crashed`;
 * - `success` / `failed`: its last `run:end`.
 */
export type GenerationState = "empty" | "unfinished" | "success" | "failed";

/**
 * What the host does with a slot:
 * - `launch`: no generation yet, create `g1`;
 * - `recreate`: delete the empty latest generation and create it again (same number);
 * - `resume`: resume the latest generation in place;
 * - `replay`: replay the finished latest generation through `execute()`, with no model calls;
 * - `retry`: start generation N+1.
 */
export type ChildAction = "launch" | "recreate" | "resume" | "replay" | "retry";

/**
 * The child lifecycle (RFC 0002 §1.2). A failed generation is never resumed:
 * plain resume reruns only a last visit that failed and was not routed on, so
 * a new generation is what reruns the item whichever way it failed. `fresh`:
 * the visit's items changed and the resume was forced, so every slot that
 * has spent anything starts a new generation.
 */
export function childAction(latest: GenerationState | undefined, fresh: boolean): ChildAction {
  if (latest === undefined) return "launch";
  if (latest === "empty") return "recreate";
  if (fresh) return "retry";
  switch (latest) {
    case "unfinished":
      return "resume";
    case "success":
      return "replay";
    case "failed":
      return "retry";
  }
}

/** One generation of one child, opened by the host. */
export interface ChildRun {
  /** `<logical id>@g<N>`. */
  runId: string;
  generation: number;
  /** What the host did to open it. */
  action: ChildAction;
  /** The generation's journal (new, or resumed). Absent: the child runs unjournaled. */
  journal?: ExecutionJournal;
  /** A fresh harness for this child. Absent: the parent's. */
  harness?: AgentHarness;
  /** Receives the child's own events. Absent: they are dropped (the parent sees child:start / child:end). */
  observer?: Observer;
  /** The child ran to its end: write `run:end` and release it. */
  end(status: "success" | "failed"): void;
  /** The map cancelled the child: release it without `run:end`, so it resumes in place. */
  detach(): void;
  /** The child stopped on an error of its own (not a cancel): release it; its next attempt resumes it. */
  crashed(): void;
}

/** What a map visit needs from its host (`ExecuteOptions.children`). */
export interface ChildRunHost {
  /** The parent run's id: the root of every child's logical id. */
  readonly runId: string;
  /** Open the child's next generation per {@link childAction}. `fresh`: see there. */
  open(ref: ChildRunRef, opts: { fresh: boolean }): Promise<ChildRun>;
  /** Spend every generation of these children journaled: the shared tally starts from it on resume. */
  spent?(refs: ChildRunRef[]): { tokens: number; costUsd: number };
}

// ─── Items ────────────────────────────────────────────────────────

/** A map visit's items, keyed and hashed, ready to register; or why the map fails before any spend. */
export type PreparedMap =
  | {
      ok: true;
      items: unknown[];
      keys: string[];
      /** The child input values `with:` names, resolved once. */
      withValues: Record<string, unknown>;
      registration: ChildRegistration;
    }
  | { ok: false; error: string };

/** The value at `input.<field>...` or `<node>.<field>...`; undefined when nothing is there. */
function valueAt(path: string, input: unknown, results: Map<string, NodeResult>): unknown {
  const segs = mapPathSegments(path);
  if (!segs) return undefined;
  const [root, ...fields] = segs;
  let v: unknown = root === "input" ? input : results.get(root)?.data;
  for (const f of fields) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
    v = (v as Record<string, unknown>)[f];
  }
  return v;
}

const kindOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/**
 * Derive a map visit's items (#575): the literal `items`, or the array at
 * `over`; at most `max_items`; each keyed (unique, `[A-Za-z0-9_-]{1,64}`);
 * every `with:` value present. Everything here is checked before any child
 * launches, so a bad list fails the map with nothing spent.
 */
export function prepareMap(node: Node, child: Workflow, input: unknown, results: Map<string, NodeResult>): PreparedMap {
  let items: unknown[];
  if (node.items !== undefined) items = node.items;
  else {
    const found = valueAt(node.over ?? "", input, results);
    if (found === undefined) return { ok: false, error: `over "${node.over}" found nothing` };
    if (!Array.isArray(found))
      return { ok: false, error: `over "${node.over}" is not a list (it is ${kindOf(found)})` };
    items = found;
  }
  const { maxItems } = mapLimits(node);
  if (items.length > maxItems)
    return { ok: false, error: `has ${items.length} items, more than max_items (${maxItems})` };
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const k = itemKeyOf(items[i], i, node.key ?? MAP_INDEX_KEY);
    if (typeof k !== "string") return { ok: false, error: k.error };
    if (seen.has(k)) return { ok: false, error: `has two items with key "${k}"; keys must be unique` };
    seen.add(k);
    keys.push(k);
  }
  const withValues: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(node.with ?? {})) {
    const v = valueAt(path, input, results);
    if (v === undefined) return { ok: false, error: `with.${name} "${path}" found nothing` };
    withValues[name] = v;
  }
  return {
    ok: true,
    items,
    keys,
    withValues,
    registration: { items_hash: canonicalHash(items), keys, workflow_hash: workflowHashOf(child) },
  };
}

// ─── One item ─────────────────────────────────────────────────────

/** How one item ended, and what the map reports for it. */
export interface ItemOutcome {
  status: MapItemStatus;
  /** The result node's output, for a success. */
  data?: Record<string, unknown>;
  /** Why it failed, was skipped or was cancelled. */
  error?: string;
  /** The generation that ran it. Absent: none was opened. */
  generation?: number;
}

/**
 * What a finished child run means for its item: failed when any node failed,
 * when the result node never ran, or when its output breaks its declared
 * schema at all (stricter than the node gate, which tolerates routing fields);
 * skipped when the result node was skipped; otherwise success with its data.
 */
export function itemOutcome(res: ExecutionResult, child: Workflow, resultNode: string): ItemOutcome {
  for (const [id, r] of res.results) {
    if (r.status !== "failed") continue;
    const why = (r.data as Record<string, unknown> | undefined)?.error;
    return { status: "failed", error: `node "${id}" failed${typeof why === "string" ? `: ${why}` : ""}` };
  }
  const r = res.results.get(resultNode);
  if (!r) return { status: "failed", error: `the child ended without running its result node "${resultNode}"` };
  if (r.status === "skipped") {
    const why = (r.data as Record<string, unknown> | undefined)?.skipped_reason;
    return { status: "skipped", ...(typeof why === "string" ? { error: why } : {}) };
  }
  const checked = checkOutputContract(r.data, child.nodes[resultNode]?.output);
  if ("error" in checked) return { status: "failed", error: `result: output validation error: ${checked.error}` };
  if (checked.problems.length > 0)
    return { status: "failed", error: `result: ${contractFailureMessage(checked.problems)}` };
  return { status: "success", data: r.data };
}

// ─── The visit ────────────────────────────────────────────────────

/** Options a child run needs that only the executor can build. */
export interface ChildExecution {
  journal?: ExecutionJournal;
  harness?: AgentHarness;
  observer?: Observer;
  signal: AbortSignal;
}

export interface MapVisit {
  nodeId: string;
  node: Node;
  iteration: number;
  child: Workflow;
  prepared: Extract<PreparedMap, { ok: true }>;
  host: ChildRunHost;
  /** The items changed since an earlier attempt registered them, and the resume was forced. */
  fresh: boolean;
  /** Runs one child to its end (the executor's `execute` with the child's options). */
  runChild: (input: unknown, exec: ChildExecution) => Promise<ExecutionResult>;
  /** Children running at once (the node's, or 1 under strict budget policy). */
  concurrency: number;
  /** The parent run's signal. */
  signal?: AbortSignal;
  logger: Logger;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Run a map visit (#575): every item as a child run through a p-limit pool.
 *
 * Fail-fast: p-limit cannot cancel a running promise, and `clearQueue()` would
 * leave dropped promises unsettled, so each task checks `stopping` before it
 * launches and returns `cancelled` without opening a generation. The first
 * failure sets `stopping` and aborts the map's signal; every running child
 * sees `AbortSignal.any([map, run])`, and one that stops on it is detached
 * (no `run:end`), so it resumes in place. The visit awaits every task.
 *
 * Results never depend on completion order: `items` by key, `order` and
 * `results` in input order.
 */
export async function runMap(v: MapVisit): Promise<NodeResult> {
  const { node, prepared, host } = v;
  const { items, keys, withValues, registration } = prepared;
  const failFast = (node.on_item_fail ?? "fail_fast") === "fail_fast";
  const outcomes: ItemOutcome[] = keys.map(() => ({ status: "cancelled" as const }));
  const mapAbort = new AbortController();
  let stopping = false;
  let firstFailure: string | undefined;
  const stop = (key: string, why: string) => {
    firstFailure ??= `item "${key}" failed: ${why}`;
    if (!failFast || stopping) return;
    stopping = true;
    mapAbort.abort(new Error(`map ${v.nodeId} stopping: ${firstFailure}`));
  };
  const runSignals = v.signal ? [mapAbort.signal, v.signal] : [mapAbort.signal];

  const limit = pLimit(Math.max(1, v.concurrency));
  const task = async (i: number): Promise<void> => {
    const key = keys[i];
    if (stopping || v.signal?.aborted) {
      outcomes[i] = {
        status: "cancelled",
        error: stopping ? "not started: the map was stopping" : "the run was aborted",
      };
      return;
    }
    const ref = childRef(
      host.runId,
      v.nodeId,
      v.iteration,
      key,
      i,
      registration.items_hash,
      registration.workflow_hash,
    );
    let run: ChildRun;
    try {
      run = await host.open(ref, { fresh: v.fresh });
    } catch (err) {
      outcomes[i] = { status: "failed", error: `could not open its child run: ${errText(err)}` };
      stop(key, outcomes[i].error!);
      return;
    }
    const childSignal = AbortSignal.any(runSignals);
    const input = { item: items[i], item_key: key, ...withValues };
    try {
      const res = await v.runChild(input, {
        ...(run.journal ? { journal: run.journal } : {}),
        ...(run.harness ? { harness: run.harness } : {}),
        ...(run.observer ? { observer: run.observer } : {}),
        signal: childSignal,
      });
      if (childSignal.aborted) {
        run.detach();
        outcomes[i] = { status: "cancelled", error: "cancelled while running", generation: run.generation };
        return;
      }
      const out = itemOutcome(res, v.child, node.result!);
      run.end(out.status === "failed" ? "failed" : "success");
      outcomes[i] = { ...out, generation: run.generation };
      if (out.status === "failed") stop(key, out.error ?? "failed");
    } catch (err) {
      if (childSignal.aborted) {
        run.detach();
        outcomes[i] = { status: "cancelled", error: "cancelled while running", generation: run.generation };
        return;
      }
      run.crashed();
      outcomes[i] = { status: "failed", error: errText(err), generation: run.generation };
      stop(key, outcomes[i].error!);
    }
  };
  await Promise.allSettled(keys.map((_, i) => limit(() => task(i))));
  return mapResult(v, outcomes, firstFailure);
}

/** The map node's result: items by key, order and results in input order, counts, and its status. */
export function mapResult(
  v: Pick<MapVisit, "nodeId" | "node" | "prepared">,
  outcomes: ItemOutcome[],
  firstFailure?: string,
): NodeResult {
  const { keys } = v.prepared;
  const items: Record<string, { status: MapItemStatus; data?: Record<string, unknown>; error?: string }> = {};
  const counts = { total: keys.length, success: 0, failed: 0, skipped: 0, cancelled: 0 };
  const results: Array<Record<string, unknown> | null> = [];
  keys.forEach((k, i) => {
    const o = outcomes[i];
    counts[o.status]++;
    items[k] = {
      status: o.status,
      ...(o.data !== undefined ? { data: o.data } : {}),
      ...(o.error !== undefined ? { error: o.error } : {}),
    };
    results.push(o.status === "success" ? (o.data ?? {}) : null);
  });
  const data: Record<string, unknown> = { items, order: [...keys], results, counts };
  let error: string | undefined;
  if (keys.length === 0) {
    if ((v.node.on_empty ?? "succeed") === "fail") error = "has no items (on_empty: fail)";
  } else if ((v.node.on_item_fail ?? "fail_fast") === "fail_fast") {
    if (counts.success + counts.skipped < counts.total)
      error = firstFailure ?? `${counts.total - counts.success - counts.skipped} item(s) did not finish`;
  } else {
    const need = v.node.min_success === undefined || v.node.min_success === "all" ? counts.total : v.node.min_success;
    if (counts.success < need) error = `${counts.success} of ${counts.total} items succeeded; the map needs ${need}`;
  }
  if (error !== undefined) data.error = `map node "${v.nodeId}" ${error}`;
  return { status: error === undefined ? "success" : "failed", data, toolCalls: [] };
}
