import {
  compareAnswers,
  formatRunsTable,
  listRuns,
  pickRunsForDiff,
  printableRun,
  readRunAnswers,
  type RunRecord,
} from "@sweny-ai/core";
import { confineHistory, oneLine, sanitizeDeep } from "./workspace.js";
import { fail, type ToolOutput } from "./result.js";

/** The fields of a run record the contract documents. Anything else a record carries is dropped. */
const RECORD_FIELDS = [
  "schema_version",
  "run_id",
  "workflow_id",
  "workflow_hash",
  "started_at",
  "duration_ms",
  "status",
  "nodes",
  "routes",
  "totals",
  "harness",
  "degraded",
  "spend",
] as const;

/**
 * A run record that is safe to hand to a model. `.sweny/runs/` is agent-writable, so the record is
 * rebuilt from the known fields (numbers coerced, strings escape-stripped by core's `printableRun`),
 * then every string is sanitized again, including the optional harness, degraded and spend blocks
 * `printableRun` passes through. Null when the record cannot be rebuilt (a forged shape): it is
 * treated as not being history.
 */
export function cleanRecord(r: RunRecord): Record<string, unknown> | null {
  try {
    const printable = printableRun(r) as unknown as Record<string, unknown>;
    const picked: Record<string, unknown> = {};
    for (const k of RECORD_FIELDS) if (Object.hasOwn(printable, k)) picked[k] = printable[k];
    return sanitizeDeep(picked) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** History records that pass core's trust checks and can be rebuilt safely. Newest first. */
function trustedRuns(cwd: string): RunRecord[] {
  return listRuns(cwd).filter((r) => cleanRecord(r) !== null);
}

export interface RunsInput {
  workflow?: string;
  limit?: number;
  root: string;
}

/** `sweny runs --json` over MCP. */
export function listRunHistory(input: RunsInput): ToolOutput {
  const history = confineHistory(input.root);
  if (!history.ok) return fail(history.error);

  let runs = trustedRuns(history.cwd);
  if (input.workflow) runs = runs.filter((r) => r.workflow_id === input.workflow);
  runs = runs.slice(0, input.limit ?? 20);

  return {
    isError: false,
    summary: formatRunsTable(runs, false, Date.now(), false).trimEnd(),
    data: { schema_version: 1, runs: runs.map((r) => cleanRecord(r)) },
  };
}

export interface RunsDiffInput {
  /** Older run: id or unique id prefix. */
  a?: string;
  /** Newer run: id or unique id prefix. */
  b?: string;
  /** Workflow to pick the default pair from. */
  workflow?: string;
  root: string;
}

/**
 * `sweny runs diff --json` over MCP: `{ schema_version: 1, a, b, answers }`, same schema as the CLI
 * (see runRunsDiff in core), with the records and answers sanitized.
 */
export function diffRuns(input: RunsDiffInput): ToolOutput {
  const history = confineHistory(input.root);
  if (!history.ok) return fail(history.error);

  const refs = [input.a, input.b].filter((x): x is string => x !== undefined);
  const picked = pickRunsForDiff(trustedRuns(history.cwd), refs, input.workflow);
  if ("error" in picked) return fail(picked.error);

  const { a, b } = picked;
  const answers = compareAnswers(readRunAnswers(a.run_id, history.cwd), readRunAnswers(b.run_id, history.cwd));

  const id = (r: RunRecord) => oneLine(r.run_id, 64);
  const hash = (r: RunRecord) => oneLine(r.workflow_hash, 64).slice(0, 7);
  const status = (r: RunRecord) => oneLine(r.status, 16);
  const lines = [
    `a ${id(a)} ${oneLine(a.workflow_id, 64)} ${status(a)}`,
    `b ${id(b)} ${oneLine(b.workflow_id, 64)} ${status(b)}`,
    a.workflow_hash === b.workflow_hash
      ? `workflow unchanged (${hash(a)})`
      : `workflow changed (${hash(a)} -> ${hash(b)})`,
    a.status === b.status ? `status ${status(b)} (same)` : `status ${status(a)} -> ${status(b)}`,
  ];
  if (answers.available) {
    const c = answers.counts;
    lines.push(`answers: ${c.added} added, ${c.resolved} resolved, ${c.changed} changed, ${c.unchanged} unchanged`);
  } else if (answers.reason === "different_workflows") {
    lines.push("answers: not compared (different workflows)");
  } else {
    const ids = answers.missing.map((m) => (m === "a" ? id(a) : id(b))).join(" and ");
    lines.push(`answers: not recorded for ${ids}`);
  }

  return {
    isError: false,
    summary: lines.join("\n"),
    data: { schema_version: 1, a: cleanRecord(a), b: cleanRecord(b), answers: sanitizeDeep(answers) },
  };
}
