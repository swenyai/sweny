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

import type { AgentHarness } from "./harness/types.js";
import type { ExecutionJournal } from "./journal.js";
import type { Observer } from "./types.js";

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
