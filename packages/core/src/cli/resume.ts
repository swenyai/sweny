/**
 * `sweny workflow resume <run-id>` (#363): checks a run journal, prints the
 * resume plan, refuses what is unsafe, and hands `workflowRunAction` the
 * journal, the run id and the run's input.
 *
 * Lives outside main.ts so tests can import it (main.ts parses argv on import).
 */

import path from "node:path";
import type { Logger, Workflow } from "../types.js";
import { validateRuntimeInput } from "../inputs.js";
import {
  JOURNAL_DIR,
  JOURNAL_FILE,
  JournalKeyError,
  JournalLockedError,
  JournalVersionError,
  RunJournal,
  buildResumePlan,
  canonicalHash,
  checkJournalAgainstWorkflow,
  findJournalRun,
  journalDir,
  mayRepeatWrites,
  readJournal,
  workflowHashOf,
  type JournalRead,
  type ResumePlan,
} from "../journal.js";
import { parseInputFlag } from "./workflow-input.js";

/** `sweny workflow resume` options (commander camelCases the flags). */
export interface ResumeOptions {
  force?: boolean;
  allowRepeatWrites?: boolean;
  /** Print the plan and exit without running anything. */
  plan?: boolean;
  /** Workflow file to load instead of the path the journal recorded. */
  workflow?: string;
  /** Same JSON as the original run's --input (needed when the journal redacted it). */
  input?: string;
}

/** Resume-only flags; the rest are shared with `workflow run`. */
export const WORKFLOW_RESUME_OPTIONS: ReadonlyArray<readonly [flags: string, description: string]> = [
  ["--plan", "Print what would be replayed and re-run, then exit without running anything"],
  [
    "--force",
    "Resume even though the workflow, its instruction files, the input, or the configured skills/agent changed (warns)",
  ],
  [
    "--allow-repeat-writes",
    "Re-run nodes that may repeat a write (not read-only, started before the crash), and re-send writes whose outcome cannot be confirmed on the provider",
  ],
  ["--workflow <file>", "Workflow file to load, when it moved since the run (its content must still match)"],
];

/** Shared `workflow run` flags that make sense on resume (no --dry-run, --stage or --list-nodes: they change the run). */
export const RESUME_SHARED_RUN_FLAGS = [
  "--timeout <ms>",
  "--max-steps <n>",
  "--json",
  "--stream",
  "--verbose",
  "--mermaid",
  "--comment-file <path>",
  "--input <json>",
  "--agent <id>",
  "--harness-policy <mode>",
];

export interface ResumeContext {
  runId: string;
  file: string;
  input: Record<string, unknown>;
  journal: RunJournal;
  plan: ResumePlan;
}

export type PrepareResumeResult =
  | { ok: true; ctx: ResumeContext; lines: string[] }
  | { ok: true; planOnly: true; lines: string[] }
  | { ok: false; error: string; lines: string[] };

export interface PrepareResumeDeps {
  cwd?: string;
  loadWorkflow: (file: string) => Workflow;
  swenyVersion?: string;
  env?: Record<string, string | undefined>;
  logger?: Logger;
}

/** One line per planned visit, for humans. */
export function formatResumePlan(plan: ResumePlan, mayRepeat: string[]): string[] {
  const lines = [`Resume run ${plan.runId} (workflow ${plan.start.workflow_id}, attempt ${plan.attempts + 1})`];
  const width = Math.max(4, ...plan.visits.map((v) => v.node.length), (plan.freshNode ?? "").length);
  const label = (node: string, iteration: number) =>
    (iteration > 1 ? `${node} (#${iteration})` : node).padEnd(width + 5);
  for (const v of plan.visits) {
    if (v.action === "replay") {
      const writes = v.applied > 0 ? `, ${v.applied} write(s) not re-sent` : "";
      lines.push(`  ✓ ${label(v.node, v.iteration)} replay from journal (${v.status}${writes})`);
    } else if (v.action === "write-stage") {
      const parts = ["agent result reused"];
      if (v.applied > 0) parts.push(`${v.applied} write(s) already applied, not re-sent`);
      if (v.unconfirmed > 0) parts.push(`${v.unconfirmed} write(s) to confirm on the provider first`);
      lines.push(`  ↻ ${label(v.node, v.iteration)} write stage only: ${parts.join("; ")}`);
    } else {
      const risk = mayRepeat.includes(v.node) ? " (may repeat writes: the node is not read-only)" : "";
      lines.push(`  ▶ ${label(v.node, v.iteration)} run again${risk}`);
    }
  }
  if (plan.freshNode) lines.push(`  ▶ ${label(plan.freshNode, 1)} run (not started before the crash)`);
  const last = plan.visits[plan.visits.length - 1];
  if (!plan.freshNode && last?.action === "replay" && last.next === undefined) {
    lines.push(`  → route from ${last.node} is decided again (not journaled before the crash)`);
  }
  if (plan.finished) lines.push("  every node finished; the resume only closes the run");
  return lines;
}

export function prepareResume(ref: string, opts: ResumeOptions, deps: PrepareResumeDeps): PrepareResumeResult {
  const cwd = deps.cwd ?? process.cwd();
  const lines: string[] = [];
  const fail = (error: string): PrepareResumeResult => ({ ok: false, error, lines });

  const runId = findJournalRun(ref, cwd);
  if (!runId) {
    return fail(
      `no run journal matches "${ref}" in ${JOURNAL_DIR}/. Runs started with --no-journal (or before journals existed) cannot be resumed.`,
    );
  }
  const file = path.join(journalDir(cwd, runId), JOURNAL_FILE);

  let read: JournalRead;
  try {
    // --plan stays read-only: a torn tail is reported, not cut.
    read = readJournal(file, { repair: !opts.plan });
  } catch (err) {
    if (err instanceof JournalVersionError || err instanceof JournalKeyError) return fail(err.message);
    return fail(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (read.forgedAtLine !== undefined) {
    return fail(
      `run journal ${file} line ${read.forgedAtLine} fails authentication: it was edited or written by something ` +
        `other than this run. Refusing to resume. Start a new run.`,
    );
  }
  if (read.corruptAtLine !== undefined) {
    return fail(
      `run journal ${file} is damaged at line ${read.corruptAtLine}, with valid records after it. ` +
        `That is not a torn last write, so it cannot be repaired safely. Start a new run.`,
    );
  }
  if (read.truncatedBytes > 0) {
    lines.push(
      opts.plan
        ? `note: the journal ends in a torn record (${read.truncatedBytes} bytes); resuming drops it`
        : `note: dropped a torn record at the end of the journal (${read.truncatedBytes} bytes)`,
    );
  }

  let plan: ResumePlan;
  try {
    plan = buildResumePlan(read.records);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (plan.lastStatus === "success") return fail(`run ${runId} already finished successfully; nothing to resume`);

  const workflowFile = opts.workflow ?? plan.start.workflow_file;
  if (!workflowFile) return fail(`the journal does not record the workflow file; pass --workflow <file>`);
  let workflow: Workflow;
  try {
    workflow = deps.loadWorkflow(workflowFile);
  } catch (err) {
    return fail(`cannot load workflow ${workflowFile}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (workflowHashOf(workflow) !== plan.start.workflow_hash) {
    if (!opts.force) {
      return fail(
        `workflow ${workflowFile} changed since run ${runId} started. Resuming would mix results from two ` +
          `different workflows. Start a new run, or pass --force to resume anyway.`,
      );
    }
    lines.push(`warning: --force: workflow ${workflowFile} changed since the run started`);
  }
  // Replayed control flow must exist in the workflow (not overridable by --force).
  const flaw = checkJournalAgainstWorkflow(read.records, workflow);
  if (flaw) return fail(`cannot resume run ${runId}: ${flaw}. Start a new run.`);

  let input: Record<string, unknown>;
  if (opts.input !== undefined) {
    const parsed = parseInputFlag(opts.input);
    if (!parsed.ok) return fail(parsed.lines.join(" "));
    const validated = validateRuntimeInput(workflow.inputs, parsed.value);
    if (!validated.ok) return fail(`--input: ${validated.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
    input = validated.value;
    if (canonicalHash(input) !== plan.start.input_hash) {
      if (!opts.force) return fail(`--input differs from the run's original input; pass the same JSON, or --force`);
      lines.push("warning: --force: --input differs from the run's original input");
    }
  } else if (plan.start.input_redacted) {
    return fail(`the run's input held secrets, which the journal does not keep; pass the same --input again`);
  } else {
    input = (plan.start.input ?? {}) as Record<string, unknown>;
  }

  const mayRepeat = mayRepeatWrites(plan, workflow, input);
  lines.push(...formatResumePlan(plan, mayRepeat));
  if (opts.plan) return { ok: true, planOnly: true, lines };
  if (mayRepeat.length > 0 && !opts.allowRepeatWrites) {
    return fail(
      `node(s) ${mayRepeat.join(", ")} started before the crash and can write outside safe outputs ` +
        `(write tools, shell, git push). Running again may repeat those writes. Check what they did, ` +
        `then resume with --allow-repeat-writes.`,
    );
  }

  let journal: RunJournal;
  try {
    journal = RunJournal.openForResume({
      runId,
      cwd,
      workflowFile: path.resolve(cwd, workflowFile),
      swenyVersion: deps.swenyVersion,
      env: deps.env,
      logger: deps.logger,
      read,
      plan,
      force: opts.force === true,
      allowRepeatWrites: opts.allowRepeatWrites === true,
    });
  } catch (err) {
    if (err instanceof JournalLockedError) return fail(err.message);
    return fail(`cannot open the run journal: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ok: true, ctx: { runId, file: path.resolve(cwd, workflowFile), input, journal, plan }, lines };
}

/** Journal is on unless `--no-journal` (options.journal === false) or `.sweny.yml` has `journal: off`. */
export function journalDisabled(optionJournal: unknown, configJournal: unknown): boolean {
  if (optionJournal === false) return true;
  return typeof configJournal === "string" && ["off", "false", "no", "0"].includes(configJournal.trim().toLowerCase());
}
