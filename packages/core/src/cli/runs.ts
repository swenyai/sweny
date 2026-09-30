/**
 * `sweny runs` and `sweny runs diff`: read-only views over `.sweny/runs/`.
 * Metadata only. Color only when `color` is true (TTY).
 */

import chalk from "chalk";
import type { Command } from "commander";
import { findRun, listRuns, type RunNodeRecord, type RunRecord } from "./run-history.js";
import { formatCost, formatReceiptDuration, formatTokenCount } from "./run-output.js";

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

const ICON: Record<string, string> = { success: "✓", failed: "✗", crashed: "✗", skipped: "−" };

function paint(text: string, status: string, color: boolean): string {
  if (!color) return text;
  if (status === "success") return chalk.green(text);
  if (status === "skipped") return chalk.dim(text);
  return chalk.red(text);
}

const tokensText = (n: number | null) => (n === null ? "-" : formatTokenCount(n));
const costText = (n: number | null) => (n === null ? "-" : formatCost(n));

function pad(s: string, w: number, right = false): string {
  return right ? s.padStart(w) : s.padEnd(w);
}

// ── sweny runs ──────────────────────────────────────────────────

export function formatRunsTable(runs: RunRecord[], color: boolean, nowMs: number = Date.now()): string {
  if (runs.length === 0) return "  No runs recorded yet. Run `sweny workflow run <file>` to start a history.\n";
  const rows = runs.map((r) => ({
    status: r.status,
    cells: [
      r.run_id,
      r.workflow_id,
      `${ICON[r.status] ?? "?"} ${r.status}`,
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
  return [color ? chalk.dim(headLine) : headLine, ...rows.map((r) => line(r.cells, r.status))].join("\n") + "\n";
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
): string | null {
  if (a === b) return null;
  if (a === null || b === null) return `${label} ${a === null ? "-" : show(a)} → ${b === null ? "-" : show(b)}`;
  return `${label} ${show(a)} → ${show(b)} (${delta(a, b)})`;
}

function nodeChanges(a: RunNodeRecord, b: RunNodeRecord): string[] {
  return [
    metric("duration", a.duration_ms, b.duration_ms, fmtDur, deltaDuration),
    metric("tokens", a.tokens, b.tokens, formatTokenCount, deltaTokens),
    metric("cost", a.cost_usd, b.cost_usd, formatCost, deltaCost),
    metric("tools", a.tool_calls, b.tool_calls, String, deltaCount),
    metric("retries", a.retries, b.retries, String, deltaCount),
  ].filter((x): x is string => x !== null);
}

const routeKey = (r: { from: string; to: string }) => `${r.from} → ${r.to}`;

export function formatRunDiff(a: RunRecord, b: RunRecord, color: boolean): string {
  const dim = (s: string) => (color ? chalk.dim(s) : s);
  const out: string[] = [];
  const hdr = (tag: string, r: RunRecord) =>
    `  ${tag}  ${r.run_id}  ${r.workflow_id}  ${paint(`${ICON[r.status] ?? "?"} ${r.status}`, r.status, color)}  ${formatReceiptDuration(r.duration_ms)}`;
  out.push(hdr("a", a), hdr("b", b), "");

  const short = (h: string) => h.slice(0, 7);
  out.push(
    a.workflow_hash === b.workflow_hash
      ? `  workflow   unchanged (${short(a.workflow_hash)})`
      : `  workflow   changed ${short(a.workflow_hash)} → ${short(b.workflow_hash)}`,
  );
  if (a.workflow_id !== b.workflow_id) out.push(`  id         ${a.workflow_id} → ${b.workflow_id}`);
  out.push(
    a.status === b.status
      ? `  status     ${ICON[b.status]} ${b.status} (same)`
      : `  status     ${ICON[a.status]} ${a.status} → ${paint(`${ICON[b.status]} ${b.status}`, b.status, color)}`,
  );
  const tot = [
    metric("duration  ", a.duration_ms, b.duration_ms, formatReceiptDuration, deltaDuration),
    metric("tokens    ", a.totals.tokens, b.totals.tokens, formatTokenCount, deltaTokens),
    metric("cost      ", a.totals.cost_usd, b.totals.cost_usd, formatCost, deltaCost),
  ];
  for (const t of tot) if (t) out.push(`  ${t}`);

  out.push("", "  nodes");
  const aNodes = new Map(a.nodes.map((n) => [n.id, n]));
  const bNodes = new Map(b.nodes.map((n) => [n.id, n]));
  const ids = [...new Set([...b.nodes.map((n) => n.id), ...a.nodes.map((n) => n.id)])];
  const w = Math.max(4, ...ids.map((i) => i.length));
  for (const id of ids) {
    const na = aNodes.get(id);
    const nb = bNodes.get(id);
    if (na && !nb) {
      out.push(`    ${pad(id, w)}  ${dim("removed")} (was ${ICON[na.status]} ${na.status})`);
    } else if (!na && nb) {
      out.push(`    ${pad(id, w)}  ${paint(`added ${ICON[nb.status]} ${nb.status}`, nb.status, color)}`);
    } else if (na && nb) {
      const st =
        na.status === nb.status ? ICON[nb.status] : `${ICON[na.status]} → ${paint(ICON[nb.status], nb.status, color)}`;
      const ch = nodeChanges(na, nb);
      out.push(`    ${pad(id, w)}  ${st}  ${ch.length ? ch.join("   ") : dim("no change")}`);
    }
  }

  out.push("", "  routes");
  const ar = new Set(a.routes.map(routeKey));
  const br = new Set(b.routes.map(routeKey));
  const onlyA = [...ar].filter((r) => !br.has(r));
  const onlyB = [...br].filter((r) => !ar.has(r));
  if (onlyA.length === 0 && onlyB.length === 0) out.push("    identical");
  for (const r of onlyA) out.push(`    - ${r}  ${dim("(only in a)")}`);
  for (const r of onlyB) out.push(`    + ${r}  ${dim("(only in b)")}`);

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
    if (!a) return { error: `No run matches "${refs[0]}". Run \`sweny runs\` to list ids.` };
    if (!b) return { error: `No run matches "${refs[1]}". Run \`sweny runs\` to list ids.` };
    return { a, b };
  }
  // No --workflow: the newest workflow that has at least two runs to compare.
  const counts = new Map<string, number>();
  for (const r of runs) counts.set(r.workflow_id, (counts.get(r.workflow_id) ?? 0) + 1);
  const wf = workflowId ?? runs.find((r) => (counts.get(r.workflow_id) ?? 0) >= 2)?.workflow_id ?? runs[0]?.workflow_id;
  const same = wf ? runs.filter((r) => r.workflow_id === wf) : [];
  if (same.length < 2) {
    return { error: wf ? `Need two runs of "${wf}" to diff; found ${same.length}.` : "No runs recorded yet." };
  }
  return { a: same[1], b: same[0] };
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
        console.error(chalk.red("  --limit must be a positive integer"));
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
      process.stdout.write("\n" + formatRunsTable(runs, process.stdout.isTTY ?? false) + "\n");
    });

  runsCmd
    .command("diff [a] [b]")
    .description("Compare two runs (default: the last two runs of the same workflow)")
    .option("--workflow <id>", "Workflow to pick the default pair from")
    .action((a: string | undefined, b: string | undefined, opts: { workflow?: string }) => {
      const refs = [a, b].filter((x): x is string => x !== undefined);
      const runs = listRuns();
      const picked = pickRunsForDiff(runs, refs, opts.workflow);
      if ("error" in picked) {
        console.error(chalk.red(`  ${picked.error}`));
        process.exitCode = 1;
        return;
      }
      process.stdout.write("\n" + formatRunDiff(picked.a, picked.b, process.stdout.isTTY ?? false) + "\n");
    });

  return runsCmd;
}
