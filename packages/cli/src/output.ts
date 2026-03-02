import chalk from "chalk";
import type { WorkflowResult, WorkflowPhase } from "@swenyai/engine";
import type { CliConfig } from "./config.js";

// ── Color palette ───────────────────────────────────────────────
export const c = {
  brand: chalk.hex("#FF6B2B"),
  brandDim: chalk.hex("#CC5522"),
  learn: chalk.hex("#60A5FA"),
  act: chalk.hex("#F59E0B"),
  report: chalk.hex("#A78BFA"),
  ok: chalk.hex("#34D399"),
  fail: chalk.hex("#F87171"),
  subtle: chalk.hex("#6B7280"),
  link: chalk.hex("#60A5FA").underline,
};

export function phaseColor(phase: string): (s: string) => string {
  return phase === "learn" ? c.learn : phase === "act" ? c.act : phase === "report" ? c.report : chalk.white;
}

// ── Utilities ───────────────────────────────────────────────────
export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

function visLen(str: string): number {
  return stripAnsi(str).length;
}

// ── Box drawing ─────────────────────────────────────────────────
const BOX_WIDTH = 50;

function padLine(line: string, width: number): string {
  const pad = Math.max(0, width - visLen(line));
  return line + " ".repeat(pad);
}

function boxTop(): string {
  return c.brandDim("  ╭" + "─".repeat(BOX_WIDTH) + "╮");
}

function boxBottom(): string {
  return c.brandDim("  ╰" + "─".repeat(BOX_WIDTH) + "╯");
}

function boxDivider(): string {
  return c.brandDim("  ├" + "─".repeat(BOX_WIDTH) + "┤");
}

function boxEmpty(): string {
  return c.brandDim("  │") + " ".repeat(BOX_WIDTH) + c.brandDim("│");
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = stripAnsi(text).split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function boxLine(content: string): string {
  const maxInner = BOX_WIDTH - 4;
  const visible = visLen(content);

  if (visible <= maxInner) {
    const inner = padLine(content, maxInner);
    return c.brandDim("  │") + "  " + inner + "  " + c.brandDim("│");
  }

  // Wrap long lines
  const wrapped = wrapText(content, maxInner);
  return wrapped
    .map((line) => {
      const padded = padLine(line, maxInner);
      return c.brandDim("  │") + "  " + padded + "  " + c.brandDim("│");
    })
    .join("\n");
}

function boxSection(lines: string[]): string[] {
  return [boxEmpty(), ...lines.map(boxLine), boxEmpty()];
}

// ── Banner ──────────────────────────────────────────────────────
export function formatBanner(config: CliConfig, version: string): string {
  const title = `${c.brand("▲")} ${chalk.bold(c.brand("SWEny"))} ${chalk.bold("Triage")}`;
  const ver = c.subtle(`v${version}`);
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(ver);

  const mode = config.dryRun ? chalk.hex("#F59E0B")("dry run") : c.ok("live");

  const header = [title + " ".repeat(Math.max(1, titlePad)) + ver];

  const rows = [
    `${c.subtle("Repository")}${" ".repeat(6)}${chalk.white(config.repository)}`,
    `${c.subtle("Agent")}${" ".repeat(11)}${chalk.white(config.codingAgentProvider)}`,
    `${c.subtle("Observability")}${" ".repeat(3)}${chalk.white(config.observabilityProvider)}`,
    `${c.subtle("Issue tracker")}${" ".repeat(3)}${chalk.white(config.issueTrackerProvider)}`,
    `${c.subtle("Time range")}${" ".repeat(6)}${chalk.white(config.timeRange)}`,
    `${c.subtle("Mode")}${" ".repeat(12)}${mode}`,
  ];

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(rows), boxBottom()].join("\n");
}

// ── Phase header ────────────────────────────────────────────────
export function formatPhaseHeader(phase: WorkflowPhase): string {
  const color = phaseColor(phase);
  const label = phase.charAt(0).toUpperCase() + phase.slice(1);
  const ruleLen = Math.max(0, 44 - label.length - 5);
  return `\n  ${c.subtle("┄┄┄")} ${color(label)} ${c.subtle("┄".repeat(ruleLen))}`;
}

// ── Step details ────────────────────────────────────────────────
export function getStepDetails(name: string, data?: Record<string, unknown>): string[] {
  if (!data) return [];
  const details: string[] = [];

  switch (name) {
    case "build-context": {
      const content = data.knownIssuesContent as string | undefined;
      if (content) {
        const count = (content.match(/^- \*\*/gm) || []).length;
        if (count > 0) details.push(`${count} known issues loaded`);
      }
      break;
    }
    case "investigate": {
      const found = data.issuesFound ? "Issues found" : "No issues found";
      const rec = data.recommendation as string | undefined;
      if (rec) details.push(`${found}, recommending: ${rec}`);
      else details.push(found);
      if (data.targetRepo) details.push(`Target: ${data.targetRepo as string}`);
      break;
    }
    case "novelty-gate": {
      const action = data.action as string | undefined;
      if (action === "dry-run") details.push("Dry run — analysis only");
      else if (action === "skip") details.push("No novel issues found");
      else if (action === "+1") details.push(`+1 on existing ${(data.issueIdentifier as string) || "issue"}`);
      else if (action === "implement") details.push("Proceeding with implementation");
      break;
    }
    case "create-issue": {
      const id = data.issueIdentifier as string | undefined;
      const title = data.issueTitle as string | undefined;
      if (id && title) details.push(`${id}: ${title}`);
      const url = data.issueUrl as string | undefined;
      if (url) details.push(url);
      break;
    }
    case "cross-repo-check": {
      if (data.dispatched) details.push(`Dispatched to ${data.targetRepo as string}`);
      break;
    }
    case "implement-fix": {
      if (data.branchName) details.push(`Branch: ${data.branchName as string}`);
      if (data.hasCodeChanges) details.push("Code changes committed");
      break;
    }
    case "create-pr": {
      const prUrl = data.prUrl as string | undefined;
      const prNum = data.prNumber as number | undefined;
      if (prUrl) details.push(`PR #${prNum ?? ""}: ${prUrl}`);
      const linked = data.issueIdentifier as string | undefined;
      if (linked) details.push(`Linked to ${linked}`);
      break;
    }
  }

  return details;
}

// ── Format step line ────────────────────────────────────────────
export function formatStepLine(icon: string, counter: string, name: string, elapsed: string, reason?: string): string {
  const label = `${counter} ${name}`;
  const pad = Math.max(1, 40 - visLen(label));
  const suffix = reason ? c.subtle(` — ${reason}`) : "";
  return `  ${icon} ${c.subtle(counter)} ${name}${" ".repeat(pad)}${c.subtle(elapsed)}${suffix}`;
}

// ── Result summary ──────────────────────────────────────────────
export function formatResultHuman(result: WorkflowResult): string {
  const duration = formatDuration(result.duration);

  // Determine outcome variant
  const investigateData = findStepData(result, "investigate");
  const issueData = findStepData(result, "create-issue");
  const prData = findStepData(result, "create-pr");
  const implData = findStepData(result, "implement-fix");
  const noveltyData = findStepData(result, "novelty-gate");
  const isDryRun = noveltyData?.action === "dry-run";

  if (result.status === "failed") {
    return formatFailureResult(result, duration);
  }

  if (isDryRun) {
    return formatDryRunResult(investigateData, duration);
  }

  if (prData?.prUrl) {
    return formatSuccessResult(issueData, prData, implData, duration);
  }

  // Partial / no action
  return formatNoActionResult(investigateData, noveltyData, duration);
}

function formatSuccessResult(
  issueData: Record<string, unknown> | undefined,
  prData: Record<string, unknown> | undefined,
  implData: Record<string, unknown> | undefined,
  duration: string,
): string {
  const title = `${c.ok("✓")} ${chalk.bold("Triage Complete")}`;
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(duration);
  const header = [title + " ".repeat(Math.max(1, titlePad)) + c.subtle(duration)];

  const body: string[] = [];
  if (issueData?.issueIdentifier) {
    body.push(`${c.subtle("Issue")}${" ".repeat(5)}${chalk.bold(String(issueData.issueIdentifier))}`);
    if (issueData.issueTitle) body.push(`${" ".repeat(10)}${String(issueData.issueTitle)}`);
    if (issueData.issueUrl) body.push(`${" ".repeat(10)}${c.link(String(issueData.issueUrl))}`);
    body.push("");
  }
  if (prData?.prUrl) {
    body.push(`${c.subtle("PR")}${" ".repeat(8)}${chalk.bold("#" + String(prData.prNumber ?? ""))}`);
    body.push(`${" ".repeat(10)}${c.link(String(prData.prUrl))}`);
    body.push("");
  }
  if (implData?.branchName) {
    body.push(`${c.subtle("Branch")}${" ".repeat(4)}${String(implData.branchName)}`);
  }

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

function formatDryRunResult(investigateData: Record<string, unknown> | undefined, duration: string): string {
  const diamond = chalk.hex("#F59E0B")("◆");
  const title = `${diamond} ${chalk.bold("Dry Run Complete")}`;
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(duration);
  const header = [title + " ".repeat(Math.max(1, titlePad)) + c.subtle(duration)];

  const body: string[] = [];
  const found = investigateData?.issuesFound ? "yes" : "no";
  body.push(`${c.subtle("Issues found")}${" ".repeat(4)}${chalk.white(found)}`);
  if (investigateData?.recommendation) {
    body.push(`${c.subtle("Recommendation")}${" ".repeat(2)}${chalk.white(String(investigateData.recommendation))}`);
  }
  body.push("");
  body.push(c.subtle("Re-run without --dry-run to take action."));

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

function formatNoActionResult(
  investigateData: Record<string, unknown> | undefined,
  noveltyData: Record<string, unknown> | undefined,
  duration: string,
): string {
  const title = `${c.subtle("−")} ${chalk.bold("No Action Needed")}`;
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(duration);
  const header = [title + " ".repeat(Math.max(1, titlePad)) + c.subtle(duration)];

  const body: string[] = [];
  if (noveltyData?.action === "+1") {
    body.push(`Added +1 to existing ${String(noveltyData.issueIdentifier || "issue")}.`);
  } else if (noveltyData?.action === "skip") {
    body.push("No novel issues found in the analyzed period.");
    body.push("All detected patterns match known issues.");
  } else {
    const rec = investigateData?.recommendation;
    if (rec) body.push(`Recommendation: ${String(rec)}`);
    else body.push("No actionable issues detected.");
  }

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

function formatFailureResult(result: WorkflowResult, duration: string): string {
  const title = `${c.fail("✗")} ${chalk.bold("Triage Failed")}`;
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(duration);
  const header = [title + " ".repeat(Math.max(1, titlePad)) + c.subtle(duration)];

  const failedStep = result.steps.find((s) => s.result.status === "failed");
  const body: string[] = [];
  if (failedStep) {
    body.push(`Failed at: ${chalk.bold(failedStep.name)} (${failedStep.phase} phase)`);
    if (failedStep.result.reason) {
      body.push("");
      body.push(failedStep.result.reason);
    }
  } else {
    body.push("An unknown error occurred.");
  }

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

// ── Validation errors ───────────────────────────────────────────
export function formatValidationErrors(errors: string[]): string {
  const title = `${c.fail("✗")} ${chalk.bold("Configuration Error")}`;
  const header = [title];

  const body: string[] = [];
  for (let i = 0; i < errors.length; i++) {
    if (i > 0) body.push("");
    body.push(`${c.subtle(`${i + 1}.`)} ${errors[i]}`);
  }

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom()].join("\n");
}

// ── Crash error ─────────────────────────────────────────────────
export function formatCrashError(error: unknown): string {
  const msg = error instanceof Error ? error.message : "Unknown error";
  const title = `${c.fail("✗")} ${chalk.bold("Unexpected Error")}`;
  const header = [title];

  const body: string[] = [
    msg,
    "",
    c.subtle("If this persists, please open an issue:"),
    c.link("https://github.com/swenyai/sweny/issues"),
  ];

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

// ── JSON output ─────────────────────────────────────────────────
export function formatResultJson(result: WorkflowResult): string {
  return JSON.stringify(result, null, 2);
}

// ── Helpers ─────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function findStepData(result: WorkflowResult, name: string): Record<string, unknown> | undefined {
  return result.steps.find((s) => s.name === name)?.result.data as Record<string, unknown> | undefined;
}
