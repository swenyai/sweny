/**
 * `sweny runs` and `sweny runs diff`: read-only views over `.sweny/runs/`.
 * `runs` lists metadata. `runs diff` compares the metadata of two runs and,
 * first, what changed in their answers (run-answers.ts). Color only when
 * `color` is true (TTY and no NO_COLOR); the glyph set follows `unicode`.
 * The diff always ends on one plain line with the answer counts.
 */

import type { Command } from "commander";
import {
  findRun,
  listRuns,
  type RunKindSpend,
  type RunNodeRecord,
  type RunRecord,
  type RunStatus,
} from "./run-history.js";
import { SPEND_KINDS } from "../budget.js";
import {
  compareAnswers,
  readRunAnswers,
  type AnswerDiff,
  type AnswerEntry,
  type AnswersComparison,
  type CollectionEntry,
  type DiffCounts,
  type DiffItem,
  type FieldChange,
} from "./run-answers.js";
import { formatCost, formatReceiptDuration, formatTokenCount } from "./run-output.js";
import { createPaint } from "./style.js";
import { colorEnabled, glyphsFor, sanitizeTerminal, supportsUnicode } from "./terminal.js";
import type { GlyphSet } from "../theme.js";

// ── Small formatters ────────────────────────────────────────────

export function formatAge(startedAt: string, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(startedAt)) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Own keys only: a status of `constructor` from a forged record must not find Object.prototype. */
const icon = (icons: Record<string, string>, status: string): string =>
  Object.hasOwn(icons, status) ? icons[status] : "?";

const iconsFor = (g: GlyphSet): Record<string, string> => ({
  success: g.success,
  failed: g.failure,
  crashed: g.failure,
  skipped: g.skipped,
});

/** Status text in its role color: success, error, or muted for skipped. */
function paint(text: string, status: string, color: boolean): string {
  if (!color) return text;
  const p = createPaint(true);
  if (status === "success") return p.success(text);
  if (status === "skipped") return p.muted(text);
  return p.error(text);
}

const tokensText = (n: number | null) => (n === null ? "-" : formatTokenCount(n));
const costText = (n: number | null) => (n === null ? "-" : formatCost(n));

function pad(s: string, w: number, right = false): string {
  return right ? s.padStart(w) : s.padEnd(w);
}

// ── History records are untrusted ───────────────────────────────

const finite = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A copy of a history record that is safe to print. `.sweny/runs/` is writable by an agent, so every
 * string read from a record goes through {@link sanitizeTerminal} (control sequences stripped, length
 * capped) and every number is coerced to a finite number. Only for display: matching and `--json`
 * use the record as read.
 */
export function printableRun(r: RunRecord): RunRecord {
  const t = (v: unknown, max = 64) => sanitizeTerminal(v, max);
  return {
    ...r,
    run_id: t(r.run_id),
    workflow_id: t(r.workflow_id),
    workflow_hash: t(r.workflow_hash),
    started_at: t(r.started_at),
    status: t(r.status, 16) as RunStatus,
    duration_ms: finite(r.duration_ms),
    nodes: r.nodes.map((n) => ({
      id: t(n.id),
      status: t(n.status, 16) as RunNodeRecord["status"],
      duration_ms: finite(n.duration_ms),
      tool_calls: finite(n.tool_calls),
      tokens: finiteOrNull(n.tokens),
      cost_usd: finiteOrNull(n.cost_usd),
      retries: finite(n.retries),
    })),
    routes: r.routes.map((e) => ({ from: t(e.from), to: t(e.to) })),
    totals: {
      nodes_total: finite(r.totals.nodes_total),
      nodes_ok: finite(r.totals.nodes_ok),
      nodes_skipped: finite(r.totals.nodes_skipped),
      tool_calls: finite(r.totals.tool_calls),
      tokens: finiteOrNull(r.totals.tokens),
      cost_usd: finiteOrNull(r.totals.cost_usd),
    },
    ...(r.spend && typeof r.spend === "object" ? { spend: printableSpend(r.spend) } : {}),
  };
}

/** The record's split, or its totals as all node spend when it has none. */
function splitOf(r: RunRecord): NonNullable<RunRecord["spend"]> {
  if (r.spend) return r.spend;
  return { node: { tokens: r.totals.tokens ?? 0, cost_usd: r.totals.cost_usd ?? 0, calls: 0 } };
}

/** Only the known kinds, own keys, finite numbers. */
function printableSpend(spend: NonNullable<RunRecord["spend"]>): NonNullable<RunRecord["spend"]> {
  const out: NonNullable<RunRecord["spend"]> = {};
  for (const k of SPEND_KINDS) {
    const v: Partial<RunKindSpend> | undefined = Object.hasOwn(spend, k) ? spend[k] : undefined;
    if (v && typeof v === "object")
      out[k] = { tokens: finite(v.tokens), cost_usd: finite(v.cost_usd), calls: finite(v.calls) };
  }
  return out;
}

// ── sweny runs ──────────────────────────────────────────────────

export function formatRunsTable(
  records: RunRecord[],
  color: boolean,
  nowMs: number = Date.now(),
  unicode: boolean = true,
): string {
  const ICON = iconsFor(glyphsFor(unicode));
  const runs = records.map(printableRun);
  if (runs.length === 0) return "  No runs recorded yet. Run `sweny workflow run <file>` to start a history.\n";
  const rows = runs.map((r) => ({
    status: r.status,
    cells: [
      r.run_id,
      r.workflow_id,
      `${icon(ICON, r.status)} ${r.status}`,
      formatReceiptDuration(r.duration_ms),
      tokensText(r.totals?.tokens ?? null),
      costText(r.totals?.cost_usd ?? null),
      formatAge(r.started_at, nowMs),
    ],
  }));
  const head = ["ID", "WORKFLOW", "STATUS", "DURATION", "TOKENS", "COST", "AGE"];
  const rightAligned = new Set([3, 4, 5]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r.cells[i].length)));
  const line = (cells: string[], status?: string) =>
    "  " +
    cells
      .map((c, i) => {
        let t = pad(c, widths[i], rightAligned.has(i));
        if (i === 2 && status) t = paint(t, status, color);
        return t;
      })
      .join("  ")
      .trimEnd();
  const headLine = line(head);
  return (
    [color ? createPaint(true).muted(headLine) : headLine, ...rows.map((r) => line(r.cells, r.status))].join("\n") +
    "\n"
  );
}

// ── sweny runs diff ─────────────────────────────────────────────

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "");

/** Like the receipt duration, but keeps one decimal under 10s so small deltas stay visible. */
function fmtDur(ms: number): string {
  return ms >= 1000 && ms < 10_000 ? `${Math.round(ms / 100) / 10}s` : formatReceiptDuration(ms);
}

const deltaDuration = (a: number, b: number) => `${sign(b - a)}${fmtDur(Math.abs(b - a))}`;
const deltaTokens = (a: number, b: number) => `${sign(b - a)}${formatTokenCount(Math.abs(b - a))}`;
const deltaCost = (a: number, b: number) => `${sign(b - a)}${formatCost(Math.abs(b - a))}`;
const deltaCount = (a: number, b: number) => `${sign(b - a)}${Math.abs(b - a)}`;

/** `label a → b (+delta)` for a numeric metric; null when unchanged. */
function metric(
  label: string,
  a: number | null,
  b: number | null,
  show: (n: number) => string,
  delta: (a: number, b: number) => string,
  arrow: string = "→",
): string | null {
  if (a === b) return null;
  if (a === null || b === null) return `${label} ${a === null ? "-" : show(a)} ${arrow} ${b === null ? "-" : show(b)}`;
  return `${label} ${show(a)} ${arrow} ${show(b)} (${delta(a, b)})`;
}

function nodeChanges(a: RunNodeRecord, b: RunNodeRecord, arrow: string): string[] {
  return [
    metric("duration", a.duration_ms, b.duration_ms, fmtDur, deltaDuration, arrow),
    metric("tokens", a.tokens, b.tokens, formatTokenCount, deltaTokens, arrow),
    metric("cost", a.cost_usd, b.cost_usd, formatCost, deltaCost, arrow),
    metric("tools", a.tool_calls, b.tool_calls, String, deltaCount, arrow),
    metric("retries", a.retries, b.retries, String, deltaCount, arrow),
  ].filter((x): x is string => x !== null);
}

const routeKey = (r: { from: string; to: string }) => `${r.from}\u0000${r.to}`;

// ── Answers section ─────────────────────────────────────────────

/** Items listed per kind (added, resolved, changed) in one list before "... and N more". The JSON keeps all. */
const MAX_ITEMS_SHOWN = 10;
const MAX_FIELDS_SHOWN = 3;
const VALUE_MAX = 56;

/** One printable line (an answer is untrusted text): see {@link sanitizeTerminal}. */
const oneLine = (s: string): string => sanitizeTerminal(s, 10_000);

function clip(s: string, max: number, g: GlyphSet): string {
  return s.length > max ? s.slice(0, max - 1) + g.ellipsis : s;
}

function showValue(v: unknown, g: GlyphSet): string {
  if (v === undefined) return "(none)";
  const text =
    typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return clip(oneLine(text), VALUE_MAX, g);
}

/** Lines in `b` not in `a` (added) and in `a` not in `b` (removed), as multisets. */
function lineDelta(a: string, b: string): { added: number; removed: number } {
  const left = new Map<string, number>();
  for (const l of a.split("\n")) left.set(l, (left.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of b.split("\n")) {
    const n = left.get(l) ?? 0;
    if (n > 0) left.set(l, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of left.values()) removed += n;
  return { added, removed };
}

/** `before -> after`, or `+X -Y lines` when either side is a long or multi-line string. */
function valueChange(before: unknown, after: unknown, g: GlyphSet): string {
  // Stored text is cut at ANSWER_STRING_MAX; the change is past the cut (found by digest).
  if (typeof before === "string" && before === after) return "changed past the stored excerpt";
  const long = (v: unknown) => typeof v === "string" && (v.includes("\n") || v.length > VALUE_MAX);
  if (typeof before === "string" && typeof after === "string" && (long(before) || long(after))) {
    const d = lineDelta(before, after);
    return `+${d.added} -${d.removed} lines`;
  }
  return `${showValue(before, g)} ${g.arrow} ${showValue(after, g)}`;
}

const isChangedEntry = (e: AnswerEntry): boolean =>
  e.kind === "collection" ? e.added.length + e.resolved.length + e.changed.length > 0 : e.status !== "unchanged";

function countsHead(e: CollectionEntry, g: GlyphSet): string {
  return [
    e.added.length ? `${e.added.length} added` : "",
    e.resolved.length ? `${e.resolved.length} resolved` : "",
    e.changed.length ? `${e.changed.length} changed` : "",
    e.unchanged ? `${e.unchanged} unchanged` : "",
  ]
    .filter(Boolean)
    .join(` ${g.sep} `);
}

/**
 * The answers block. Marker colors keep the palette's meanings: `+` a new item
 * is `warning` (look at this), `-` a resolved one is `success`, `~` a changed
 * one is `info`; counts and unchanged nodes are `muted`.
 */
function formatAnswersSection(cmp: AnswerDiff, color: boolean, g: GlyphSet): string[] {
  const p = createPaint(color);
  const out: string[] = ["  answers"];
  const items = (marker: string, paintMarker: (s: string) => string, list: DiffItem[], word: string) => {
    for (const it of list.slice(0, MAX_ITEMS_SHOWN)) {
      out.push(`        ${paintMarker(marker)} ${clip(oneLine(it.label), 72, g)}`);
    }
    if (list.length > MAX_ITEMS_SHOWN) {
      out.push(p.muted(`        ${g.ellipsis} and ${list.length - MAX_ITEMS_SHOWN} more ${word}`));
    }
  };
  // Node, field and nested field names are keys of agent-writable files: terminal text, not trusted.
  const key = (s: string) => sanitizeTerminal(s, 64);
  const fields = (list: FieldChange[]) => {
    if (list.length === 0) return;
    const w = Math.max(...list.map((f) => key(f.field).length));
    for (const f of list.slice(0, MAX_FIELDS_SHOWN)) {
      out.push(`            ${pad(key(f.field), w)}  ${valueChange(f.before, f.after, g)}`);
    }
    if (list.length > MAX_FIELDS_SHOWN)
      out.push(p.muted(`            ${g.ellipsis} and ${list.length - MAX_FIELDS_SHOWN} more fields`));
  };

  const nodes = [...new Set(cmp.entries.map((e) => e.node))];
  for (const node of nodes) {
    const changed = cmp.entries.filter((e) => e.node === node && isChangedEntry(e));
    if (changed.length === 0) {
      out.push(`    ${key(node)}  ${p.muted("unchanged")}`);
      continue;
    }
    out.push(`    ${key(node)}`);
    const w = Math.max(...changed.map((e) => key(e.field).length));
    for (const e of changed) {
      if (e.kind === "collection") {
        out.push(`      ${pad(key(e.field), w)}  ${p.muted(countsHead(e, g))}`);
        items("+", p.warning, e.added, "added");
        items("-", p.success, e.resolved, "resolved");
        for (const c of e.changed.slice(0, MAX_ITEMS_SHOWN)) {
          out.push(`        ${p.info("~")} ${clip(oneLine(c.label), 72, g)}`);
          fields(c.fields);
        }
        if (e.changed.length > MAX_ITEMS_SHOWN) {
          out.push(p.muted(`        ${g.ellipsis} and ${e.changed.length - MAX_ITEMS_SHOWN} more changed`));
        }
      } else if (e.status === "added") {
        out.push(`      ${pad(key(e.field), w)}  ${p.warning("added")} ${showValue(e.after, g)}`);
      } else if (e.status === "resolved") {
        out.push(
          `      ${pad(key(e.field), w)}  ${p.success("resolved")} ${p.muted(`(was ${showValue(e.before, g)})`)}`,
        );
      } else {
        out.push(`      ${pad(key(e.field), w)}  ${valueChange(e.before, e.after, g)}`);
      }
    }
  }
  for (const n of cmp.not_compared) {
    out.push(`    ${key(n.node)}  ${p.muted(`not compared (answer in ${n.only_in} only)`)}`);
  }
  if (nodes.length === 0 && cmp.not_compared.length === 0) out.push(p.muted("    no declared outputs to compare"));
  return out;
}

const countsLine = (c: DiffCounts): string =>
  `${c.added} added, ${c.resolved} resolved, ${c.changed} changed, ${c.unchanged} unchanged`;

/** The last line of the diff: plain text, no color, no glyphs, so a log or a grep always has the answer. */
function answersFinalLine(cmp: AnswersComparison, a: RunRecord, b: RunRecord): string {
  if (cmp.available) return `  answers: ${countsLine(cmp.counts)}`;
  if (cmp.reason === "different_workflows") return "  answers: not compared (different workflows)";
  const ids = cmp.missing.map((m) => (m === "a" ? a.run_id : b.run_id)).join(" and ");
  return `  answers: not recorded for ${ids} (runs made with --no-history, or by an older sweny, have none)`;
}

export interface RunDiffOptions {
  /** Answer comparison for the pair; when set the diff leads with it and ends on its summary line. */
  answers?: AnswersComparison;
  /** Unicode glyphs (default) or the ASCII set. */
  unicode?: boolean;
}

export function formatRunDiff(rawA: RunRecord, rawB: RunRecord, color: boolean, opts: RunDiffOptions = {}): string {
  const a = printableRun(rawA);
  const b = printableRun(rawB);
  const g = glyphsFor(opts.unicode ?? true);
  const ICON = iconsFor(g);
  const dim = createPaint(color).muted;
  const out: string[] = [];
  const hdr = (tag: string, r: RunRecord) =>
    `  ${tag}  ${r.run_id}  ${r.workflow_id}  ${paint(`${icon(ICON, r.status)} ${r.status}`, r.status, color)}  ${formatReceiptDuration(r.duration_ms)}`;
  out.push(hdr("a", a), hdr("b", b), "");

  if (opts.answers?.available) out.push(...formatAnswersSection(opts.answers, color, g), "");

  const short = (h: string) => h.slice(0, 7);
  out.push(
    a.workflow_hash === b.workflow_hash
      ? `  workflow   unchanged (${short(a.workflow_hash)})`
      : `  workflow   changed ${short(a.workflow_hash)} ${g.arrow} ${short(b.workflow_hash)}`,
  );
  if (a.workflow_id !== b.workflow_id) out.push(`  id         ${a.workflow_id} ${g.arrow} ${b.workflow_id}`);
  out.push(
    a.status === b.status
      ? `  status     ${icon(ICON, b.status)} ${b.status} (same)`
      : `  status     ${icon(ICON, a.status)} ${a.status} ${g.arrow} ${paint(`${icon(ICON, b.status)} ${b.status}`, b.status, color)}`,
  );
  const tot = [
    metric("duration  ", a.duration_ms, b.duration_ms, formatReceiptDuration, deltaDuration, g.arrow),
    metric("tokens    ", a.totals.tokens, b.totals.tokens, formatTokenCount, deltaTokens, g.arrow),
    metric("cost      ", a.totals.cost_usd, b.totals.cost_usd, formatCost, deltaCost, g.arrow),
  ];
  for (const t of tot) if (t) out.push(`  ${t}`);
  // Spend by kind, when either run has the split: what moved the totals. A
  // record without one (node-only, or written before the split) is all node spend.
  if (a.spend || b.spend) {
    const sa = splitOf(a);
    const sb = splitOf(b);
    const byCost = SPEND_KINDS.some((k) => (sa[k]?.cost_usd ?? 0) > 0 || (sb[k]?.cost_usd ?? 0) > 0);
    for (const k of SPEND_KINDS) {
      const va = sa[k];
      const vb = sb[k];
      if (!va && !vb) continue;
      const label = `  ${pad(k, 10)}`;
      const line = byCost
        ? metric(label, va ? va.cost_usd : null, vb ? vb.cost_usd : null, formatCost, deltaCost, g.arrow)
        : metric(label, va ? va.tokens : null, vb ? vb.tokens : null, formatTokenCount, deltaTokens, g.arrow);
      if (line) out.push(`  ${line}`);
    }
  }

  out.push("", "  nodes");
  const aNodes = new Map(a.nodes.map((n) => [n.id, n]));
  const bNodes = new Map(b.nodes.map((n) => [n.id, n]));
  const ids = [...new Set([...b.nodes.map((n) => n.id), ...a.nodes.map((n) => n.id)])];
  const w = Math.max(4, ...ids.map((i) => i.length));
  for (const id of ids) {
    const na = aNodes.get(id);
    const nb = bNodes.get(id);
    if (na && !nb) {
      out.push(`    ${pad(id, w)}  ${dim("removed")} (was ${icon(ICON, na.status)} ${na.status})`);
    } else if (!na && nb) {
      out.push(`    ${pad(id, w)}  ${paint(`added ${icon(ICON, nb.status)} ${nb.status}`, nb.status, color)}`);
    } else if (na && nb) {
      const st =
        na.status === nb.status
          ? icon(ICON, nb.status)
          : `${icon(ICON, na.status)} ${g.arrow} ${paint(icon(ICON, nb.status), nb.status, color)}`;
      const ch = nodeChanges(na, nb, g.arrow);
      out.push(`    ${pad(id, w)}  ${st}  ${ch.length ? ch.join("   ") : dim("no change")}`);
    }
  }

  out.push("", "  routes");
  const show = (key: string) => key.split("\u0000").join(` ${g.arrow} `);
  const ar = new Set(a.routes.map(routeKey));
  const br = new Set(b.routes.map(routeKey));
  const onlyA = [...ar].filter((r) => !br.has(r));
  const onlyB = [...br].filter((r) => !ar.has(r));
  if (onlyA.length === 0 && onlyB.length === 0) out.push("    identical");
  for (const r of onlyA) out.push(`    - ${show(r)}  ${dim("(only in a)")}`);
  for (const r of onlyB) out.push(`    + ${show(r)}  ${dim("(only in b)")}`);

  if (opts.answers) out.push("", answersFinalLine(opts.answers, a, b));
  return out.join("\n") + "\n";
}

/** Pick two runs: explicit refs, or the newest two runs of one workflow (--workflow, else the newest workflow with two or more runs). a = older, b = newer. */
export function pickRunsForDiff(
  runs: RunRecord[],
  refs: string[],
  workflowId?: string,
): { a: RunRecord; b: RunRecord } | { error: string } {
  if (refs.length === 1) return { error: "Pass two run ids, or none to diff the last two runs of a workflow." };
  if (refs.length === 2) {
    const a = findRun(runs, refs[0]);
    const b = findRun(runs, refs[1]);
    if (!a) return { error: `No run matches "${sanitizeTerminal(refs[0], 64)}". Run \`sweny runs\` to list ids.` };
    if (!b) return { error: `No run matches "${sanitizeTerminal(refs[1], 64)}". Run \`sweny runs\` to list ids.` };
    return { a, b };
  }
  // No --workflow: the newest workflow that has at least two runs to compare.
  const counts = new Map<string, number>();
  for (const r of runs) counts.set(r.workflow_id, (counts.get(r.workflow_id) ?? 0) + 1);
  const wf = workflowId ?? runs.find((r) => (counts.get(r.workflow_id) ?? 0) >= 2)?.workflow_id ?? runs[0]?.workflow_id;
  const same = wf ? runs.filter((r) => r.workflow_id === wf) : [];
  if (same.length < 2) {
    return {
      error: wf
        ? `Need two runs of "${sanitizeTerminal(wf, 64)}" to diff; found ${same.length}. Run it again, then \`sweny runs diff\`.`
        : "No runs recorded yet. Run `sweny workflow run <file>` twice, then `sweny runs diff`.",
    };
  }
  return { a: same[1], b: same[0] };
}

// ── sweny runs diff: command body ───────────────────────────────

type OutStream = { isTTY?: boolean; write(chunk: string): unknown };

export interface RunsDiffIo {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout: OutStream;
  stderr: OutStream;
}

/**
 * Body of `sweny runs diff`. Returns the exit code (0 diffed, 1 nothing to diff).
 *
 * `--json` prints `{ schema_version: 1, a: RunRecord, b: RunRecord, answers }` and never ANSI.
 * `answers` is `{ available: true, counts, entries, not_compared }` or
 * `{ available: false, reason: "different_workflows" | "missing_answers", missing? }`.
 */
export function runRunsDiff(refs: string[], opts: { workflow?: string; json?: boolean }, io: RunsDiffIo): number {
  const env = io.env ?? process.env;
  const picked = pickRunsForDiff(listRuns(io.cwd), refs, opts.workflow);
  if ("error" in picked) {
    io.stderr.write(createPaint(colorEnabled(io.stderr, env)).error(`  ${picked.error}`) + "\n");
    return 1;
  }
  const { a, b } = picked;
  const answers = compareAnswers(readRunAnswers(a.run_id, io.cwd), readRunAnswers(b.run_id, io.cwd));
  if (opts.json) {
    io.stdout.write(JSON.stringify({ schema_version: 1, a, b, answers }, null, 2) + "\n");
    return 0;
  }
  io.stdout.write(
    "\n" + formatRunDiff(a, b, colorEnabled(io.stdout, env), { answers, unicode: supportsUnicode(env) }) + "\n",
  );
  return 0;
}

// ── Command wiring ──────────────────────────────────────────────

export function registerRunsCommand(program: Command): Command {
  const runsCmd = program
    .command("runs")
    .description("List recent workflow runs recorded in .sweny/runs/ (metadata only)")
    .option("--workflow <id>", "Only runs of this workflow")
    .option("--limit <n>", "Max runs to show", "20")
    .option("--json", "Output run records as JSON")
    .action((opts: { workflow?: string; limit?: string; json?: boolean }) => {
      const limit = Number(opts.limit ?? "20");
      if (!Number.isInteger(limit) || limit < 1) {
        console.error(createPaint(colorEnabled(process.stderr)).error("  --limit must be a positive integer"));
        process.exitCode = 1;
        return;
      }
      let runs = listRuns();
      if (opts.workflow) runs = runs.filter((r) => r.workflow_id === opts.workflow);
      runs = runs.slice(0, limit);
      if (opts.json) {
        process.stdout.write(JSON.stringify(runs, null, 2) + "\n");
        return;
      }
      process.stdout.write(
        "\n" + formatRunsTable(runs, colorEnabled(process.stdout), Date.now(), supportsUnicode()) + "\n",
      );
    });

  runsCmd
    .command("diff [a] [b]")
    .description(
      "Compare two runs: what changed in the answers, then how they ran (default: the last two of a workflow)",
    )
    .option("--workflow <id>", "Workflow to pick the default pair from")
    .option("--json", "Output { schema_version, a, b, answers } as JSON")
    .action((a: string | undefined, b: string | undefined, opts: { workflow?: string; json?: boolean }) => {
      const refs = [a, b].filter((x): x is string => x !== undefined);
      const code = runRunsDiff(refs, opts, { stdout: process.stdout, stderr: process.stderr });
      if (code !== 0) process.exitCode = code;
    });

  return runsCmd;
}
