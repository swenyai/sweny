/**
 * `sweny try`: a zero-credential demo (#475).
 *
 * Replays a recorded explain-repo run through the REAL executor, with a replay
 * harness standing in for the agent, so the real progress line, answer block
 * (#460), receipt, policy segment and PR-comment markdown (#396) are what a
 * user sees. No agent, no model, no network, no env credentials, no files
 * written (no `.sweny/runs`, no journal). The environment handed to the
 * executor is empty by construction.
 *
 * The recording lives in `try-fixture.json` (metadata plus the sample answer
 * only). Until a real run is recorded it is labelled illustrative.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { execute } from "../executor.js";
import { validateParsed } from "../loader.js";
import type { AgentHarness, HarnessCapabilities, HarnessRunResult } from "../harness/types.js";
import type { ExecutionEvent, Logger, NodeResult, Observer, ToolCall, Workflow } from "../types.js";
import { WORKFLOW_TEMPLATES } from "./templates.js";
import { formatFinalOutput, resolveFinalOutput } from "./final-output.js";
import { formatRunComment } from "./comment-output.js";
import { formatReceiptDuration, renderReceiptLine, summarizeRun } from "./run-output.js";
import { c } from "./output.js";

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
  notice: string;
  /** Built-in template id the recording is of. */
  workflow: string;
  sample_repo: string;
  harness: { id: string; version: string };
  policy?: { envScope: boolean; sandbox: "off" | "auto" | "strict"; sandboxStarted: boolean };
  /** Node id to recording, in execution order. */
  nodes: Record<string, TryFixtureNode>;
}

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
export function createReplayHarness(fixture: TryFixture, opts: { paceMs: number }): AgentHarness {
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
      const step = toolCalls.length > 0 ? opts.paceMs / toolCalls.length : opts.paceMs;
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

/** The real commands, same as the README quickstart. */
export const TRY_NEXT_COMMANDS = [
  "npm install -g @sweny-ai/core",
  "sweny new --template explain-repo --yes",
  "sweny workflow run .sweny/workflows/explain-repo.yml",
] as const;

/** Appended to `sweny try --help`. */
export const TRY_HELP_NOTE =
  "The recording is ILLUSTRATIVE SAMPLE DATA (a fictional repo, hand-written timings and token counts), not output from a real run. " +
  "Nothing runs: no agent, no network, no credentials read, no files written.";

export function formatTryBanner(fixture: TryFixture): string {
  const lines = [
    `${c.brand("▲")} ${chalk.bold("sweny try")}  ${chalk.bold.yellow(TRY_BANNER_TITLE)}, not a live run`,
    chalk.dim(`  A replay of an ${fixture.workflow} run on a sample repo (${fixture.sample_repo}).`),
    chalk.dim(
      fixture.illustrative
        ? "  The sample data is illustrative, not output from your code. No agent, no network, no credentials."
        : "  No agent, no network, no credentials.",
    ),
  ];
  return lines.map((l, i) => (i === 0 ? `  ${l}` : l)).join("\n");
}

export function formatTryNext(): string {
  return [
    `  ${chalk.bold("Run it for real")} on your own repo:`,
    "",
    ...TRY_NEXT_COMMANDS.map((cmd) => `    ${cmd}`),
    "",
    chalk.dim("  Needs a Claude login (`claude` signed in) or ANTHROPIC_API_KEY. Your run ends with the same receipt."),
  ].join("\n");
}

// ── Run ─────────────────────────────────────────────────────────

export interface TryOptions {
  /** Replay instantly. */
  fast?: boolean;
  /** Milliseconds each node takes to replay. Default 1200. Ignored with `fast`. */
  paceMs?: number;
  /** Also write the PR-comment markdown here. */
  commentFile?: string;
  /** Output sink. Default stdout. */
  write?: (s: string) => void;
  /** Rewrite progress lines in place. Default: stdout is a TTY. */
  tty?: boolean;
  fixture?: TryFixture;
}

export const DEFAULT_TRY_PACE_MS = 1200;

const silentLogger: Logger = { info() {}, warn() {}, error() {}, debug() {} };

/** Replay the recording. Returns the process exit code. */
export async function runTry(opts: TryOptions = {}): Promise<number> {
  const write = opts.write ?? ((s: string) => void process.stdout.write(s));
  const tty = opts.tty ?? Boolean(process.stdout.isTTY);
  const paceMs = opts.fast ? 0 : Math.max(0, opts.paceMs ?? DEFAULT_TRY_PACE_MS);
  const fixture = opts.fixture ?? loadTryFixture();
  const workflow = loadTryWorkflow(fixture.workflow);
  for (const id of Object.keys(fixture.nodes)) {
    if (!workflow.nodes[id]) throw new Error(`try-fixture.json: node "${id}" is not in ${fixture.workflow}`);
  }

  write(`\n${formatTryBanner(fixture)}\n\n`);

  const ticks = new Map<string, number>();
  const observer: Observer = (event: ExecutionEvent) => {
    switch (event.type) {
      case "workflow:start":
        write(`  ${c.brand("▲")} ${chalk.bold(event.workflow)}\n\n`);
        break;
      case "node:enter":
        ticks.set(event.node, 0);
        if (tty) write(`  ${c.subtle("○")} ${chalk.dim(event.node)}…`);
        break;
      case "node:progress": {
        const n = (ticks.get(event.node) ?? 0) + 1;
        ticks.set(event.node, n);
        if (tty) {
          write(
            `\r\x1B[2K  ${c.subtle("○")} ${chalk.dim(event.node)}… ${chalk.dim(`${n} tool ${n === 1 ? "call" : "calls"}`)}`,
          );
        }
        break;
      }
      case "node:exit": {
        const rec = fixture.nodes[event.node];
        const ok = event.result.status === "success";
        const icon = ok ? c.ok("✓") : c.fail("✗");
        const calls = event.result.toolCalls.length;
        const detail = [formatReceiptDuration(rec?.duration_ms ?? 0), ...(calls > 0 ? [`${calls} tool calls`] : [])];
        write(`${tty ? "\r\x1B[2K" : ""}  ${icon} ${event.node}  ${chalk.dim(detail.join(" · "))}\n`);
        break;
      }
    }
  };

  const { results, trace } = await execute(
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
  write("\n");

  // The recording's timings, not the replay's wall clock.
  const durationsMs = Object.fromEntries(Object.entries(fixture.nodes).map(([id, n]) => [id, n.duration_ms]));
  const totalMs = Object.values(durationsMs).reduce((a, b) => a + b, 0);
  const receipt = summarizeRun(results, totalMs, false, trace);

  const answer = resolveFinalOutput(workflow, results);
  if (answer) write(`${formatFinalOutput(answer)}\n\n`);
  write(`  ${renderReceiptLine(receipt, tty)}\n\n`);

  const comment = formatRunComment(workflow, results as Map<string, NodeResult>, receipt, { trace, durationsMs });
  write(`  ${chalk.dim("What CI posts on a pull request (sweny workflow run --comment-file):")}\n\n`);
  write(
    `${comment
      .split("\n")
      .map((l) => (l === "" ? l : `    ${l}`))
      .join("\n")}\n`,
  );
  if (opts.commentFile) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(opts.commentFile)), { recursive: true });
      fs.writeFileSync(opts.commentFile, comment);
    } catch (err) {
      process.stderr.write(`  ⚠ could not write comment file: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  write(`${formatTryNext()}\n\n`);
  return receipt.ok ? 0 : 1;
}

export function registerTryCommand(program: Command): Command {
  return program
    .command("try")
    .description("Replay a recorded demo run: no credentials, no network, no model calls (illustrative sample data)")
    .option("--fast", "Replay instantly instead of pacing the progress")
    .option("--pace <ms>", `Milliseconds each node takes to replay (default ${DEFAULT_TRY_PACE_MS})`)
    .option("--comment-file <path>", "Also write the PR-comment markdown to <path>")
    .addHelpText("after", `\n${TRY_HELP_NOTE}\n`)
    .action(async (options: { fast?: boolean; pace?: string; commentFile?: string }) => {
      let paceMs: number | undefined;
      if (options.pace !== undefined) {
        paceMs = Number(options.pace);
        if (!Number.isFinite(paceMs) || paceMs < 0) {
          console.error(chalk.red(`\n  --pace must be a non-negative number of milliseconds, got "${options.pace}"\n`));
          process.exitCode = 1;
          return;
        }
      }
      process.exitCode = await runTry({ fast: options.fast, paceMs, commentFile: options.commentFile });
    });
}
