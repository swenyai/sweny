/**
 * The receipt ticket: the run receipt as a small perforated card with a tear
 * line and a policy stamp. Shown at the end of a run on a TTY, and at the top
 * of the PR comment. CI logs, pipes and `--json` keep the plain receipt line.
 *
 * METADATA ONLY, like the receipt line: counts, durations, tokens, cost,
 * policy facts. Never prompts, node outputs, tool inputs, or model prose.
 */

import type { RunSummary } from "./run-output.js";
import {
  formatBudgetAmount,
  formatCost,
  formatDeciderCounts,
  formatReceiptDuration,
  formatTokenCount,
  policyParts,
  renderReceiptLine,
} from "./run-output.js";
import { createPaint, type Paint } from "./style.js";
import { colorEnabled, glyphsFor, richOutput, supportsUnicode, terminalColumns, ticketBoxFor } from "./terminal.js";

/** Widest ticket, in columns, frame included. */
export const TICKET_MAX_WIDTH = 48;
/** Narrowest ticket. Below this the fields stop being readable. */
export const TICKET_MIN_WIDTH = 32;
/** Left indent the CLI prints the ticket at. */
export const TICKET_INDENT = 2;
/** How long the stub sits empty before the stamp lands (the one animation frame). */
export const STAMP_DELAY_MS = 140;

const LABEL_WIDTH = 12;

export interface TicketData {
  summary: RunSummary;
  /** Workflow id, shown under the status. */
  workflow: string;
  /** Full run id; the ticket shows its short hash. */
  runId?: string;
  /** The run crashed before finishing (not a node failure). */
  crashed?: boolean;
}

export interface TicketRenderOptions {
  /** Columns available, indent included. Default 80. The ticket fits in `columns - 2`. */
  columns?: number;
  /** Box drawing and glyphs in Unicode (default) or ASCII. */
  unicode?: boolean;
  /** Painters. Default: no color. */
  paint?: Paint;
  /** Draw the policy stamp. False leaves the stub empty: the frame before the stamp lands. Default true. */
  stamp?: boolean;
}

export interface RenderedTicket {
  /** The ticket, one string per row, no indent. */
  lines: string[];
  /** Index of the stamp row in `lines`, or -1 when the run reported no policy facts. */
  stampRow: number;
}

/** `20260930-110000-3f9a2c` shows as `3f9a2c`; any other id as its first 8 characters. */
export function shortRunId(runId: string): string {
  const m = /-([0-9a-f]{6,})$/i.exec(runId);
  return m ? m[1] : runId.slice(0, 8);
}

/** The ticket's status word. */
export function ticketStatus(data: TicketData): "passed" | "failed" | "budget stop" | "crashed" {
  if (data.crashed) return "crashed";
  if (data.summary.budget) return "budget stop";
  return data.summary.ok ? "passed" : "failed";
}

/**
 * The policy stamp words, from what the run reported: `ENV SCOPED`,
 * `SANDBOXED`. Empty when no node reported env scope or sandbox facts.
 * `strong` is false when any fact is weaker than the default (an unscoped
 * env, no sandbox), which the stamp shows in the warning color.
 */
export function stampWords(summary: RunSummary): { words: string[]; strong: boolean } {
  const p = summary.policy;
  const words: string[] = [];
  let strong = true;
  if (p?.envScope !== undefined) {
    words.push(p.envScope ? "ENV SCOPED" : "ENV UNSCOPED");
    strong &&= p.envScope;
  }
  if (p?.sandbox) {
    const on = p.sandbox.mode !== "off" && p.sandbox.started;
    words.push(on ? "SANDBOXED" : "UNSANDBOXED");
    strong &&= on;
  }
  return { words, strong };
}

/** Field rows, label then value, metadata only. */
function ticketFields(s: RunSummary): Array<[label: string, value: string]> {
  const failed = Math.max(0, s.nodesTotal - s.nodesOk - s.nodesSkipped);
  const nodes = [
    `${s.nodesOk}/${s.nodesTotal}`,
    ...(failed > 0 ? [`${failed} failed`] : []),
    ...(s.nodesSkipped > 0 ? [`${s.nodesSkipped} skipped`] : []),
  ].join(", ");
  const policy = policyParts(s.policy);
  return [
    ["nodes", nodes],
    ["tool calls", String(s.toolCalls)],
    ["duration", formatReceiptDuration(s.durationMs)],
    ...(s.tokens !== undefined ? [["tokens", formatTokenCount(s.tokens)] as [string, string]] : []),
    ...(s.costUsd !== undefined ? [["cost", formatCost(s.costUsd)] as [string, string]] : []),
    ...(s.harness !== undefined && s.harness !== "claude-code" ? [["harness", s.harness] as [string, string]] : []),
    ...(s.degraded && s.degraded.length > 0 ? [["degraded", s.degraded.join(", ")] as [string, string]] : []),
    ...(s.decider ? [["decider", formatDeciderCounts(s.decider)] as [string, string]] : []),
    ...(s.budget
      ? [
          ["budget", `${formatBudgetAmount(s.budget)} (${s.budget.scope})`] as [string, string],
          ["stopped at", s.budget.node] as [string, string],
        ]
      : []),
    ...(policy.length > 0 ? [["policy", policy.join(", ")] as [string, string]] : []),
  ];
}

/** Word-wrap to `width`, hard-breaking any word longer than the line. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (let word of text.split(" ")) {
    while (word.length > width) {
      if (line) {
        out.push(line);
        line = "";
      }
      out.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line || out.length === 0) out.push(line);
  return out;
}

function clip(text: string, width: number, ellipsis: string): string {
  if (text.length <= width) return text;
  return text.slice(0, Math.max(0, width - ellipsis.length)) + ellipsis;
}

/** Ticket width for a terminal of `columns`: fits beside the indent, within the min and max. */
export function ticketWidth(columns: number): number {
  return Math.max(TICKET_MIN_WIDTH, Math.min(TICKET_MAX_WIDTH, columns - TICKET_INDENT));
}

/**
 * Render the ticket. Pure: same input, same rows. Every row is exactly the
 * ticket width in visible columns.
 */
export function renderTicket(data: TicketData, opts: TicketRenderOptions = {}): RenderedTicket {
  const unicode = opts.unicode ?? true;
  const paint = opts.paint ?? createPaint(false);
  const box = ticketBoxFor(unicode);
  const g = glyphsFor(unicode);
  const width = ticketWidth(opts.columns ?? 80);
  const inner = width - 4;
  const valueWidth = inner - LABEL_WIDTH;
  const s = data.summary;
  const frame = paint.muted;

  const edge = (left: string, fill: string, right: string) => {
    const run = fill.repeat(Math.ceil((width - 2) / fill.length)).slice(0, width - 2);
    return frame(left + run + right);
  };
  /** One content row: `raw` sets the width, `painted` is what prints. */
  const row = (raw: string, painted: string = raw) =>
    `${frame(box.vertical)} ${painted}${" ".repeat(Math.max(0, inner - raw.length))} ${frame(box.vertical)}`;

  const lines: string[] = [edge(box.topLeft, box.horizontal, box.topRight)];

  // Status and run id.
  const status = ticketStatus(data);
  const good = status === "passed";
  const tone = good ? paint.success : paint.error;
  const left = `${good ? g.success : g.failure} ${status}`;
  const right = data.runId ? `run ${shortRunId(data.runId)}` : "";
  const gap = inner - left.length - right.length;
  if (right && gap >= 2) {
    lines.push(row(left + " ".repeat(gap) + right, paint.strong(tone(left)) + " ".repeat(gap) + paint.muted(right)));
  } else {
    lines.push(row(left, paint.strong(tone(left))));
  }
  const name = clip(data.workflow, inner, g.ellipsis);
  lines.push(row(name));
  lines.push(row(""));

  // Fields, aligned: label column then value column; long values wrap under the value.
  for (const [label, value] of ticketFields(s)) {
    wrap(value, valueWidth).forEach((part, i) => {
      const lab = (i === 0 ? label : "").padEnd(LABEL_WIDTH);
      lines.push(row(lab + part, paint.muted(lab) + part));
    });
  }

  // Tear line and stub with the policy stamp.
  let stampRow = -1;
  const stamp = stampWords(s);
  if (stamp.words.length > 0) {
    lines.push(edge(box.tearLeft, box.tear, box.tearRight));
    let text = `[ ${stamp.words.join(` ${g.sep} `)} ]`;
    if (text.length > inner) text = clip(stamp.words.join(` ${g.sep} `), inner, g.ellipsis);
    const padL = Math.floor((inner - text.length) / 2);
    const raw = " ".repeat(padL) + text;
    stampRow = lines.length;
    if (opts.stamp === false) lines.push(row(""));
    else lines.push(row(raw, " ".repeat(padL) + paint.strong((stamp.strong ? paint.brand : paint.warning)(text))));
  }

  lines.push(edge(box.bottomLeft, box.horizontal, box.bottomRight));
  return { lines, stampRow };
}

/** The ticket as plain text (no color, Unicode): what the PR comment carries. */
export function formatTicketText(data: TicketData, columns: number = TICKET_MAX_WIDTH + TICKET_INDENT): string {
  return renderTicket(data, { columns }).lines.join("\n");
}

// ── Printing ────────────────────────────────────────────────────

export interface ReceiptStream {
  write(s: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

export interface WriteReceiptOptions extends Omit<TicketData, "summary"> {
  stream: ReceiptStream;
  env?: Record<string, string | undefined>;
  /** Land the stamp one frame after the ticket. Default true on a rich stream. */
  animate?: boolean;
  /** Override the rich (ticket) or plain (one line) choice. Default: `richOutput(stream, env)`. */
  rich?: boolean;
  /** Override color. Default: `colorEnabled(stream, env)`. */
  color?: boolean;
  /** Override Unicode. Default: `supportsUnicode(env)`. */
  unicode?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Print the receipt. A TTY (not CI) gets the ticket, its stamp landing one
 * frame after the card; anything else gets the plain line. Both end with a
 * blank line.
 */
export async function writeReceipt(summary: RunSummary, opts: WriteReceiptOptions): Promise<void> {
  const env = opts.env ?? process.env;
  const { stream } = opts;
  const color = opts.color ?? colorEnabled(stream, env);
  const rich = opts.rich ?? richOutput(stream, env);
  if (!rich) {
    stream.write(`  ${renderReceiptLine(summary, color)}\n\n`);
    return;
  }
  const data: TicketData = { summary, workflow: opts.workflow, runId: opts.runId, crashed: opts.crashed };
  const base: TicketRenderOptions = {
    columns: terminalColumns(stream, env),
    unicode: opts.unicode ?? supportsUnicode(env),
    paint: createPaint(color),
  };
  const pad = " ".repeat(TICKET_INDENT);
  const full = renderTicket(data, base);
  const animate = (opts.animate ?? true) && full.stampRow >= 0;
  if (!animate) {
    stream.write(full.lines.map((l) => pad + l).join("\n") + "\n\n");
    return;
  }
  const blank = renderTicket(data, { ...base, stamp: false });
  stream.write(blank.lines.map((l) => pad + l).join("\n") + "\n");
  await sleep(STAMP_DELAY_MS);
  // Up to the stub row, redraw it with the stamp, back down below the ticket.
  const up = full.lines.length - full.stampRow;
  stream.write(`\x1B[${up}A\r\x1B[2K${pad}${full.lines[full.stampRow]}\x1B[${up}B\r\n`);
}
