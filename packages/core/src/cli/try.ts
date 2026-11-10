/**
 * `sweny try`: a zero-credential demo (#475).
 *
 * Replays a recorded explain-repo run through the REAL executor, with a replay
 * harness standing in for the agent, so the real progress lines, answer block
 * (#460), receipt ticket, policy stamp and PR comment (#396, #479) are what a
 * user sees. No agent, no model, no network, no env credentials, no files
 * written (no `.sweny/runs`, no journal). The environment handed to the
 * executor is empty by construction.
 *
 * The recording lives in `try-fixture.json` (metadata plus the sample answer
 * only). Until a real run is committed (`illustrative: false`, made by
 * `sweny try --capture`, try-capture.ts) it is labelled illustrative; a real one
 * says "replay of a real run on <date>" instead.
 */

import fs from "node:fs";
import { workspaceRoot, writeFileNoFollow } from "../safe-file.js";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { execute } from "../executor.js";
import { validateParsed } from "../loader.js";
import type { AgentHarness, HarnessCapabilities, HarnessRunResult } from "../harness/types.js";
import type { ExecutionEvent, Logger, NodeResult, Observer, ToolCall, Workflow } from "../types.js";
import { WORKFLOW_TEMPLATES } from "./templates.js";
import { formatFinalOutput, resolveFinalOutput, type FinalOutput } from "./final-output.js";
import { formatRunComment } from "./comment-output.js";
import { formatReceiptDuration, summarizeRun } from "./run-output.js";
import { DagRenderer } from "./renderer.js";
import { createNodeProgress, toolCallsText } from "./progress.js";
import { createPaint, type Paint } from "./style.js";
import { colorEnabled, glyphsFor, richOutput, supportsUnicode, terminalColumns } from "./terminal.js";
import { writeReceipt } from "./ticket.js";
import { SWENY_TAGLINE } from "../theme.js";

// ── Fixture ─────────────────────────────────────────────────────

export interface TryFixtureNode {
  /** Recorded wall-clock time of the node. */
  duration_ms: number;
  /** Tool name to number of calls. Counts only: no inputs or outputs are recorded. */
  tool_calls: Record<string, number>;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number; numTurns?: number };
  /** The node's declared output fields (the sample answer). */
  output?: Record<string, unknown>;
}

export interface TryFixture {
  schema_version: 1;
  /** True until the owner replaces the file with a recording of a real run. */
  illustrative: boolean;
  /**
   * When the recorded run started (ISO 8601). Required when `illustrative` is false: the label says
   * "replay of a real run on <date>".
   */
  captured_at?: string;
  notice: string;
  /** Built-in template id the recording is of. */
  workflow: string;
  sample_repo: string;
  harness: { id: string; version: string };
  policy?: { envScope: boolean; sandbox: "off" | "auto" | "strict"; sandboxStarted: boolean };
  /** Node id to recording, in execution order. */
  nodes: Record<string, TryFixtureNode>;
}

const CAPTURED_AT_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Shape check with a message naming the first bad field. Throws on a malformed fixture. */
export function parseTryFixture(raw: unknown): TryFixture {
  const bad = (what: string): never => {
    throw new Error(`try-fixture.json: ${what}`);
  };
  if (!isObj(raw)) return bad("expected an object");
  if (raw.schema_version !== 1) bad("schema_version must be 1");
  for (const key of ["notice", "workflow", "sample_repo"] as const) {
    if (typeof raw[key] !== "string" || raw[key] === "") bad(`${key} must be a non-empty string`);
  }
  if (typeof raw.illustrative !== "boolean") bad("illustrative must be a boolean");
  if (raw.illustrative === false && (typeof raw.captured_at !== "string" || !CAPTURED_AT_RE.test(raw.captured_at))) {
    bad("a real recording (illustrative: false) needs captured_at, an ISO date such as 2026-11-12T14:00:00.000Z");
  }
  if (raw.captured_at !== undefined && (typeof raw.captured_at !== "string" || !CAPTURED_AT_RE.test(raw.captured_at))) {
    bad("captured_at must be an ISO date");
  }
  if (!isObj(raw.harness) || typeof raw.harness.id !== "string" || typeof raw.harness.version !== "string") {
    bad("harness must be { id, version }");
  }
  if (!isObj(raw.nodes) || Object.keys(raw.nodes).length === 0) return bad("nodes must be a non-empty object");
  for (const [id, n] of Object.entries(raw.nodes)) {
    if (!isObj(n) || typeof n.duration_ms !== "number" || !isObj(n.tool_calls)) {
      bad(`nodes.${id} needs duration_ms and tool_calls`);
    }
    for (const [tool, count] of Object.entries((n as Record<string, unknown>).tool_calls as Record<string, unknown>)) {
      if (!Number.isInteger(count) || (count as number) < 0) bad(`nodes.${id}.tool_calls.${tool} must be a count`);
    }
  }
  return raw as unknown as TryFixture;
}

/** The shipped fixture: `try-fixture.json` next to this module (src/cli or dist/cli). */
export function loadTryFixture(file?: string): TryFixture {
  const p = file ?? fileURLToPath(new URL("./try-fixture.json", import.meta.url));
  return parseTryFixture(JSON.parse(fs.readFileSync(p, "utf-8")));
}

/** The real explain-repo template, parsed and validated like any workflow file. */
export function loadTryWorkflow(templateId: string): Workflow {
  const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) throw new Error(`try-fixture.json: unknown template "${templateId}"`);
  const loaded = validateParsed(parseYaml(tpl.yaml));
  if (!loaded.ok)
    throw new Error(`template ${templateId} is invalid: ${loaded.errors.map((e) => e.message).join("; ")}`);
  return loaded.workflow;
}

// ── Replay harness ──────────────────────────────────────────────

const REPLAY_CAPABILITIES: HarnessCapabilities = {
  structuredOutput: "prompt",
  toolTrace: "skill-only",
  builtinDeny: "none",
  mcp: { inject: false, exclusive: "none" },
  sandbox: { fs: false, network: false },
  readOnly: "none",
  turnLimit: "none",
  usage: { tokens: true, costUsd: true, live: false },
  cancel: "signal",
  resume: false,
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * An AgentHarness that plays the recording back: node N of the run gets
 * recording N. It never spawns a process, reads env, or touches the network.
 * `paceMs` is how long each node takes to replay (0 = instant); tool calls are
 * reported through `onProgress` spread across that time so progress feels live.
 */
export function createReplayHarness(
  fixture: TryFixture,
  opts: { paceMs: number | ((nodeId: string) => number) },
): AgentHarness {
  const order = Object.keys(fixture.nodes);
  let next = 0;
  return {
    id: "mock",
    capabilities: REPLAY_CAPABILITIES,
    async preflight() {
      return { ok: true, version: "replay" };
    },
    // Routing and judging never run in a linear recorded workflow; fail closed if asked.
    async complete() {
      return null;
    },
    async run(req): Promise<HarnessRunResult> {
      const id = order[next++];
      const rec = id ? fixture.nodes[id] : undefined;
      const harness = { id: fixture.harness.id as HarnessRunResult["harness"]["id"], version: fixture.harness.version };
      if (!rec) {
        return {
          status: "failed",
          data: { error: "recording has no more nodes" },
          toolCalls: [],
          harness,
          degraded: [],
        };
      }
      const toolCalls: ToolCall[] = [];
      for (const [tool, count] of Object.entries(rec.tool_calls)) {
        for (let i = 0; i < count; i++) toolCalls.push({ tool, input: {} });
      }
      const nodePace = typeof opts.paceMs === "function" ? opts.paceMs(id as string) : opts.paceMs;
      const step = toolCalls.length > 0 ? nodePace / toolCalls.length : nodePace;
      for (const tc of toolCalls) {
        await sleep(step, req.signal);
        req.onProgress?.(tc.tool);
      }
      if (toolCalls.length === 0) await sleep(step, req.signal);
      return {
        status: "success",
        data: { ...(rec.output ?? {}) },
        toolCalls,
        ...(rec.usage ? { usage: rec.usage } : {}),
        ...(fixture.policy ? { policy: fixture.policy } : {}),
        harness,
        degraded: [],
      };
    },
  };
}

// ── Output ──────────────────────────────────────────────────────

export const TRY_BANNER_TITLE = "Recorded demo";

/** The one command to run next: scaffolds the same workflow on the user's repo and says how to run it. */
export const TRY_NEXT_COMMAND = "npx @sweny-ai/core new --template explain-repo";

/** Appended to `sweny try --help`. */
export const TRY_HELP_NOTE =
  "The recording is ILLUSTRATIVE SAMPLE DATA (a fictional repo, hand-written timings and token counts), not output from a real run. " +
  "Nothing runs: no agent, no network, no credentials read, no files written.";

/** `YYYY-MM-DD` of the recorded run, or "" when the fixture carries none. */
export function capturedDate(fixture: TryFixture): string {
  return fixture.captured_at?.slice(0, 10) ?? "";
}

/** What the recording is, in one clause: the label `sweny try` shows. Illustrative until a real run is committed. */
export function tryLabel(fixture: TryFixture): string {
  return fixture.illustrative
    ? `of ${fixture.workflow} on a sample repo (${fixture.sample_repo}), illustrative data`
    : `of ${fixture.workflow} on ${fixture.sample_repo}, a replay of a real run on ${capturedDate(fixture)}`;
}

/** The note under `sweny try --help`, for the recording that ships. */
export function tryHelpNote(fixture: TryFixture): string {
  return fixture.illustrative
    ? TRY_HELP_NOTE
    : `The recording is a replay of a real run of ${fixture.workflow} on ${fixture.sample_repo} (${capturedDate(fixture)}): ` +
        "recorded tool-call counts, tokens, cost and answer (redacted), timings scaled for replay. " +
        "Nothing runs now: no agent, no network, no credentials read, no files written.";
}

/** The tagline, then the demo notice as one dim line. */
export function formatTryBanner(fixture: TryFixture, paint: Paint = createPaint(false), unicode = true): string {
  const g = glyphsFor(unicode);
  return [
    `  ${paint.brand(g.brand)} ${paint.strong("SWEny")}  ${SWENY_TAGLINE}`,
    paint.muted(`  ${TRY_BANNER_TITLE} ${tryLabel(fixture)}. No agent, network or credentials.`),
  ].join("\n");
}

/** The closing line: one command. */
export function formatTryNext(paint: Paint = createPaint(false)): string {
  return `  ${paint.muted("Run it on your repo:")}  ${paint.strong(TRY_NEXT_COMMAND)}`;
}

// ── Run ─────────────────────────────────────────────────────────

export interface TryOptions {
  /** Replay instantly (and land the stamp without the one-frame pause). */
  fast?: boolean;
  /**
   * Milliseconds each node takes to replay, fixed. Default: the recorded timings scaled to about
   * {@link REPLAY_TARGET_MS} in total, and instant when output is not a live terminal (non-TTY, CI,
   * dumb terminal). Ignored with `fast`.
   */
  paceMs?: number;
  /** Also write the PR-comment markdown here. */
  commentFile?: string;
  /** Output sink. Default stdout. */
  write?: (s: string) => void;
  /** Rich output: spinner, ticket, color. Default: stdout is a TTY. */
  tty?: boolean;
  /** Draw with Unicode. Default: what the terminal supports. */
  unicode?: boolean;
  /** Force ANSI color on or off. Default: on for a TTY that allows color. */
  color?: boolean;
  /** Force the receipt ticket (true) or the plain receipt line (false). Default: `tty`. */
  rich?: boolean;
  /** Terminal width. Default: stdout's. */
  columns?: number;
  /**
   * Show at most this many items of each list in the answer, with the count in its heading
   * ("How to run it (2 of 8):"). The recording uses it to stay README-sized; a real terminal run
   * leaves it unset and shows the whole answer.
   */
  compactAnswer?: number;
  fixture?: TryFixture;
}

/** A default replay takes about this long in total, however long the real run took. */
export const REPLAY_TARGET_MS = 8000;
/** No node replays faster than this unless the replay is instant. */
export const REPLAY_NODE_MIN_MS = 250;

/** Per-node replay time: the recorded durations scaled to {@link REPLAY_TARGET_MS} in total (never slowed down). */
export function scaledPace(fixture: TryFixture, targetMs: number = REPLAY_TARGET_MS): (nodeId: string) => number {
  const total = Object.values(fixture.nodes).reduce((a, n) => a + n.duration_ms, 0);
  const scale = total > targetMs ? targetMs / total : 1;
  return (id) => Math.max(REPLAY_NODE_MIN_MS, Math.round((fixture.nodes[id]?.duration_ms ?? 0) * scale));
}

/**
 * The answer with each list cut to its first `maxItems` items; the heading then says
 * "<title> (<maxItems> of <total>):". Scalars, short lists and errors pass through. Pure.
 */
export function compactAnswer(out: FinalOutput, maxItems: number): FinalOutput {
  if (out.kind !== "result" || !Number.isInteger(maxItems) || maxItems < 1) return out;
  const src = out.lines;
  const lines: string[] = [];
  let i = 0;
  while (i < src.length) {
    const head = src[i];
    // A list is a heading with no value ("Key files:") followed by "- " items and their indented continuations.
    if (!/^[^\s-].*:$/.test(head) || !src[i + 1]?.startsWith("- ")) {
      lines.push(head);
      i++;
      continue;
    }
    const items: string[][] = [];
    let j = i + 1;
    while (j < src.length && (src[j].startsWith("- ") || src[j].startsWith(" "))) {
      if (src[j].startsWith("- ")) items.push([src[j]]);
      else items[items.length - 1].push(src[j]);
      j++;
    }
    if (items.length <= maxItems) lines.push(head, ...items.flat());
    else lines.push(`${head.slice(0, -1)} (${maxItems} of ${items.length}):`, ...items.slice(0, maxItems).flat());
    i = j;
  }
  return { ...out, lines };
}

const silentLogger: Logger = { info() {}, warn() {}, error() {}, debug() {} };

/** The line that opens the job summary preview (record.ts cuts the preview from here). */
export const SUMMARY_PREVIEW_LEAD = "In CI, the job summary gets this heading, this DAG and the receipt below:";

/** Replay the recording. Returns the process exit code. */
export async function runTry(opts: TryOptions = {}): Promise<number> {
  const write = opts.write ?? ((s: string) => void process.stdout.write(s));
  const tty = opts.tty ?? Boolean(process.stdout.isTTY);
  const fixture = opts.fixture ?? loadTryFixture();
  // Explicit pace wins. Otherwise real timings, scaled, on a live terminal only: a pipe, CI or a
  // dumb terminal gets the replay at once (the receipt shows the recorded times either way).
  const paceMs: number | ((nodeId: string) => number) = opts.fast
    ? 0
    : opts.paceMs !== undefined
      ? Math.max(0, opts.paceMs)
      : richOutput({ isTTY: tty }, process.env)
        ? scaledPace(fixture)
        : 0;
  const workflow = loadTryWorkflow(fixture.workflow);
  for (const id of Object.keys(fixture.nodes)) {
    if (!workflow.nodes[id]) throw new Error(`try-fixture.json: node "${id}" is not in ${fixture.workflow}`);
  }

  const env = process.env;
  const unicode = opts.unicode ?? supportsUnicode(env);
  const color = opts.color ?? (tty && colorEnabled({ isTTY: true }, env));
  const paint = createPaint(color);
  const g = glyphsFor(unicode);
  const columns = opts.columns ?? terminalColumns(process.stdout, env);

  write(`\n${formatTryBanner(fixture, paint, unicode)}\n\n`);

  const progress = createNodeProgress({
    write,
    live: tty,
    unicode,
    paint,
    idWidth: Math.max(...Object.keys(fixture.nodes).map((id) => id.length)),
  });
  // The same events drive the DAG in the comment preview.
  const dag = new DagRenderer(workflow, { legend: false, unicode });
  const observer: Observer = (event: ExecutionEvent) => {
    dag.update(event);
    switch (event.type) {
      case "node:enter":
        progress.enter(event.node);
        break;
      case "node:progress":
        progress.tick(event.node);
        break;
      case "node:exit": {
        const rec = fixture.nodes[event.node];
        const calls = event.result.toolCalls.length;
        // The recording's timing, not the replay's wall clock.
        const detail = [formatReceiptDuration(rec?.duration_ms ?? 0), ...(calls > 0 ? [toolCallsText(calls)] : [])];
        const status =
          event.result.status === "success" ? "success" : event.result.status === "failed" ? "failed" : "skipped";
        progress.exit(event.node, status, detail.join(` ${g.sep} `));
        break;
      }
    }
  };

  let executed: Awaited<ReturnType<typeof execute>>;
  try {
    executed = await execute(
      workflow,
      {},
      {
        skills: new Map(),
        harness: createReplayHarness(fixture, { paceMs }),
        observer,
        logger: silentLogger,
        // Nothing for the executor to read: no credentials, no PATH, no config.
        env: {},
        offline: true,
        harnessPolicy: "warn",
      },
    );
  } finally {
    progress.stop();
  }
  const { results, trace } = executed;
  write("\n");

  const durationsMs = Object.fromEntries(Object.entries(fixture.nodes).map(([id, n]) => [id, n.duration_ms]));
  const totalMs = Object.values(durationsMs).reduce((a, b) => a + b, 0);
  const receipt = summarizeRun(results, totalMs, false, trace);

  const answer = resolveFinalOutput(workflow, results);
  if (answer) {
    const shown = opts.compactAnswer ? compactAnswer(answer, opts.compactAnswer) : answer;
    write(`${formatFinalOutput(shown)}\n\n`);
  }

  // Compact preview of CI's job summary: heading and DAG here, receipt below.
  const comment = formatRunComment(workflow, results as Map<string, NodeResult>, receipt, { trace, durationsMs });
  write(`  ${paint.muted(SUMMARY_PREVIEW_LEAD)}\n\n`);
  const tone = receipt.ok ? paint.success : paint.error;
  write(`    ${tone(receipt.ok ? g.success : g.failure)} ${paint.strong(workflow.name)}\n\n`);
  write(
    `${dag
      .renderToString()
      .split("\n")
      .slice(2)
      .map((l) => (l === "" ? l : `  ${l}`))
      .join("\n")}\n\n`,
  );

  await writeReceipt(receipt, {
    workflow: workflow.id,
    runId: "demo",
    stream: { write, isTTY: tty, columns },
    env,
    rich: opts.rich ?? tty,
    color,
    unicode,
    animate: !opts.fast,
  });
  if (opts.commentFile) {
    try {
      writeFileNoFollow(opts.commentFile, comment, { ...workspaceRoot(opts.commentFile), mode: 0o644, dirMode: 0o755 });
    } catch (err) {
      process.stderr.write(
        `  ${g.warning} could not write comment file: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  }

  write(`${formatTryNext(paint)}\n\n`);
  return receipt.ok ? 0 : 1;
}

/** The shipped fixture's label, falling back to the illustrative wording when it cannot be read. */
function shippedHelp(): { description: string; note: string } {
  try {
    const fixture = loadTryFixture();
    return {
      description: fixture.illustrative
        ? "Replay a recorded demo run: no credentials, no network, no model calls (illustrative sample data)"
        : "Replay a recorded real run: no credentials, no network, no model calls",
      note: tryHelpNote(fixture),
    };
  } catch {
    return {
      description: "Replay a recorded demo run: no credentials, no network, no model calls (illustrative sample data)",
      note: TRY_HELP_NOTE,
    };
  }
}

export function registerTryCommand(program: Command): Command {
  const help = shippedHelp();
  return program
    .command("try")
    .description(help.description)
    .option("--fast", "Replay instantly instead of pacing the progress")
    .option(
      "--pace <ms>",
      `Fixed milliseconds per node (default: the recorded timings scaled to about ${REPLAY_TARGET_MS / 1000}s, instant when not a live terminal)`,
    )
    .option("--comment-file <path>", "Also write the PR-comment markdown to <path>")
    .option("--record <file.svg>", "Write the demo as an animated, self-contained SVG terminal recording to <file.svg>")
    .option(
      "--capture <run>",
      "Convert a recorded run (latest, a run id, or a path under .sweny/runs) into a try fixture instead of replaying",
    )
    .option("--repo <owner/name>", "With --capture: the repo the run was on (default: GITHUB_REPOSITORY)")
    .option("--out <file>", "With --capture: write the fixture to <file> (default: stdout)")
    .addHelpText("after", `\n${help.note}\n`)
    .action(
      async (options: {
        fast?: boolean;
        pace?: string;
        commentFile?: string;
        record?: string;
        capture?: string;
        repo?: string;
        out?: string;
      }) => {
        if (options.capture) {
          try {
            const { captureTryFixture } = await import("./try-capture.js");
            const res = captureTryFixture({ ref: options.capture, repo: options.repo, out: options.out });
            if (res.wrote) process.stderr.write(`  wrote ${res.wrote} (replay of run ${res.fixture.captured_at})\n`);
            else process.stdout.write(res.text);
          } catch (err) {
            console.error(`\n  could not capture the run: ${err instanceof Error ? err.message : err}\n`);
            process.exitCode = 1;
          }
          return;
        }
        if (options.record) {
          try {
            const { recordTrySvgToFile } = await import("./record.js");
            const bytes = await recordTrySvgToFile(options.record);
            process.stdout.write(`  wrote ${options.record} (${bytes} bytes)\n`);
          } catch (err) {
            console.error(`\n  could not record the demo: ${err instanceof Error ? err.message : err}\n`);
            process.exitCode = 1;
          }
          return;
        }
        let paceMs: number | undefined;
        if (options.pace !== undefined) {
          paceMs = Number(options.pace);
          if (!Number.isFinite(paceMs) || paceMs < 0) {
            console.error(
              createPaint(colorEnabled(process.stderr)).error(
                `\n  --pace must be a non-negative number of milliseconds, got "${options.pace}"\n`,
              ),
            );
            process.exitCode = 1;
            return;
          }
        }
        process.exitCode = await runTry({ fast: options.fast, paceMs, commentFile: options.commentFile });
      },
    );
}
