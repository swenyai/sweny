/**
 * `sweny try --capture <run>`: turn a recorded run into the `sweny try` fixture (#537).
 *
 * Input is what a real run already left in `.sweny/runs/`: the history record
 * (`<run-id>.json`, run-history.ts) and the answers (`<run-id>/answers.json`,
 * run-answers.ts). Output is a `TryFixture` with `illustrative: false`, so
 * `sweny try` labels it "a replay of a real run on <date>".
 *
 * Nothing is invented. Durations, tool-call counts, token and cost totals, the
 * harness, the policy floor and the answer all come from the record. A run that
 * lacks them (written before `detail_version` 1), failed, or answered nothing is
 * refused with the reason, never padded. The answer is redacted a second time
 * here (the journal's redactor plus the run's secret values), so a token that
 * slipped past the first pass does not reach a committed file.
 *
 * Deterministic: fixed key order, no clock, no randomness. The same run always
 * yields the same bytes.
 */

import fs from "node:fs";
import path from "node:path";
import { redact, runSecretValues } from "../journal.js";
import { readRunAnswers, type RunAnswers } from "./run-answers.js";
import { RUN_HISTORY_DIR, RUN_ID_RE, findRun, listRuns, type RunNodeRecord, type RunRecord } from "./run-history.js";
import { loadTryWorkflow, parseTryFixture, type TryFixture, type TryFixtureNode } from "./try.js";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface CaptureOptions {
  /** `owner/name` of the repo the run was on (a record does not hold it). */
  sampleRepo: string;
  /** Extra secret values to scrub from the answer. Default: none beyond the redactor's patterns. */
  secrets?: string[];
}

function usageOf(n: RunNodeRecord): TryFixtureNode["usage"] | undefined {
  const usage: NonNullable<TryFixtureNode["usage"]> = {};
  if (typeof n.tokens_in === "number") usage.inputTokens = n.tokens_in;
  if (typeof n.tokens_out === "number") usage.outputTokens = n.tokens_out;
  if (typeof n.cost_usd === "number") usage.costUsd = n.cost_usd;
  if (typeof n.num_turns === "number") usage.numTurns = n.num_turns;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

/**
 * The fixture for one recorded run. Throws, naming the reason, when the run cannot honestly be one:
 * not a success, no detail (older record), no harness, an unknown template or node, or no answers.
 */
export function buildTryFixture(record: RunRecord, answers: RunAnswers | null, opts: CaptureOptions): TryFixture {
  const refuse = (why: string): never => {
    throw new Error(`cannot capture run ${record.run_id}: ${why}`);
  };
  if (!REPO_RE.test(opts.sampleRepo)) refuse(`--repo must look like owner/name, got "${opts.sampleRepo}"`);
  if (record.status !== "success") refuse(`it ended ${record.status}; a demo is captured from a successful run`);
  if (typeof record.detail_version !== "number" || record.detail_version < 1) {
    refuse("it predates per-tool call counts (no detail_version). Re-run with a sweny that records them");
  }
  if (!record.harness) refuse("it recorded no harness");
  if (!record.policy) refuse("it recorded no policy floor (env scope and sandbox)");
  if (!answers) refuse("it has no answers.json");
  if (answers!.run_id !== record.run_id || answers!.workflow_id !== record.workflow_id) {
    refuse("answers.json belongs to a different run");
  }
  if (record.nodes.length === 0) refuse("it recorded no nodes");

  const workflow = loadTryWorkflow(record.workflow_id);
  const secrets = opts.secrets ?? [];
  const nodes: Record<string, TryFixtureNode> = {};
  for (const n of record.nodes) {
    if (!workflow.nodes[n.id]) refuse(`node "${n.id}" is not in the ${record.workflow_id} template`);
    if (n.status !== "success") refuse(`node "${n.id}" ended ${n.status}`);
    const usage = usageOf(n);
    const declared = answers!.nodes[n.id];
    const output = declared ? (redact(declared, secrets).value as Record<string, unknown>) : undefined;
    nodes[n.id] = {
      duration_ms: n.duration_ms,
      tool_calls: { ...(n.tool_counts ?? {}) },
      ...(usage ? { usage } : {}),
      ...(output && Object.keys(output).length > 0 ? { output } : {}),
    };
  }
  if (!Object.values(nodes).some((n) => n.output)) refuse("no node recorded an answer");

  const date = record.started_at.slice(0, 10);
  return parseTryFixture({
    schema_version: 1,
    illustrative: false,
    captured_at: record.started_at,
    notice:
      `A replay of a real run of ${record.workflow_id} on ${opts.sampleRepo}, started ${record.started_at.slice(0, 19)}Z (${date}). ` +
      "Durations, tool-call counts, token usage and cost are as recorded; the answer is redacted. " +
      "Made by `sweny try --capture`; do not edit by hand.",
    workflow: record.workflow_id,
    sample_repo: opts.sampleRepo,
    harness: { id: record.harness!.id, version: record.harness!.version },
    policy: {
      envScope: record.policy!.scoped,
      sandbox: record.policy!.sandbox,
      sandboxStarted: record.policy!.sandboxed,
    },
    nodes,
  });
}

/** The committed bytes: two-space JSON, a trailing newline. */
export function serializeTryFixture(fixture: TryFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

export interface CaptureSource {
  record: RunRecord;
  answers: RunAnswers | null;
}

/**
 * Find the run a `--capture` argument names, through the same validating readers `sweny runs` uses
 * (history is agent-writable, so a planted or linked file is skipped, not trusted). `ref` is
 * `latest` (newest record under `<cwd>/.sweny/runs`), a run id or unique prefix, or a path to the run
 * dir (`.sweny/runs/<id>`) or its record (`.sweny/runs/<id>.json`).
 */
export function resolveCaptureRun(ref: string, cwd: string = process.cwd()): CaptureSource {
  let root = cwd;
  let wanted = ref;
  if (ref !== "latest" && !RUN_ID_RE.test(ref)) {
    const abs = path.resolve(cwd, ref);
    const id = path.basename(abs).replace(/\.json$/, "");
    const runsDir = path.dirname(abs);
    const stateDir = path.dirname(runsDir);
    if (path.basename(runsDir) !== path.basename(RUN_HISTORY_DIR) || path.basename(stateDir) !== ".sweny") {
      // Not a path into .sweny/runs: maybe a unique id prefix.
      wanted = ref;
    } else {
      root = path.dirname(stateDir);
      wanted = id;
    }
  }
  const runs = listRuns(root);
  const record = wanted === "latest" ? runs[0] : findRun(runs, wanted);
  if (!record) {
    throw new Error(
      `no run "${ref}" under ${path.join(root, RUN_HISTORY_DIR)}` +
        (runs.length === 0 ? " (no runs recorded there)" : ""),
    );
  }
  return { record, answers: readRunAnswers(record.run_id, root) };
}

export interface CaptureRequest {
  ref: string;
  repo?: string;
  /** Write the fixture here. Default: return it for stdout. */
  out?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

/** Resolve, convert and (when `out` is set) write. Returns the fixture text and where it went. */
export function captureTryFixture(req: CaptureRequest): { text: string; fixture: TryFixture; wrote?: string } {
  const env = req.env ?? process.env;
  const cwd = req.cwd ?? process.cwd();
  const repo = req.repo ?? env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("--repo owner/name is required (GITHUB_REPOSITORY is not set)");
  const { record, answers } = resolveCaptureRun(req.ref, cwd);
  const fixture = buildTryFixture(record, answers, { sampleRepo: repo, secrets: runSecretValues(undefined, env) });
  const text = serializeTryFixture(fixture);
  if (!req.out) return { text, fixture };
  const file = path.resolve(cwd, req.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o644 });
  return { text, fixture, wrote: file };
}
