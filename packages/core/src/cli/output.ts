import chalk from "chalk";
import type { CliConfig } from "./config.js";
import type { CheckResult } from "./check.js";
import type { NodeResult, ExecutionEvent } from "../types.js";

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
  return c.brandDim("  \u256D" + "\u2500".repeat(BOX_WIDTH) + "\u256E");
}

function boxBottom(): string {
  return c.brandDim("  \u2570" + "\u2500".repeat(BOX_WIDTH) + "\u256F");
}

function boxDivider(): string {
  return c.brandDim("  \u251C" + "\u2500".repeat(BOX_WIDTH) + "\u2524");
}

function boxEmpty(): string {
  return c.brandDim("  \u2502") + " ".repeat(BOX_WIDTH) + c.brandDim("\u2502");
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
    return c.brandDim("  \u2502") + "  " + inner + "  " + c.brandDim("\u2502");
  }

  // Wrap long lines
  const wrapped = wrapText(content, maxInner);
  return wrapped
    .map((line) => {
      const padded = padLine(line, maxInner);
      return c.brandDim("  \u2502") + "  " + padded + "  " + c.brandDim("\u2502");
    })
    .join("\n");
}

function boxSection(lines: string[]): string[] {
  return [boxEmpty(), ...lines.map(boxLine), boxEmpty()];
}

// ── Banner ──────────────────────────────────────────────────────
export function formatBanner(config: CliConfig, version: string): string {
  const title = `${c.brand("\u25B2")} ${chalk.bold(c.brand("SWEny"))} ${chalk.bold("Triage")}`;
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
// TODO: The old engine had WorkflowPhase; in the new DAG model phases are not
// a first-class concept. This helper is kept for backward compat if needed.
export function formatPhaseHeader(phase: string): string {
  const color = phaseColor(phase);
  const label = phase.charAt(0).toUpperCase() + phase.slice(1);
  const ruleLen = Math.max(0, 44 - label.length - 5);
  return `\n  ${c.subtle("\u2504\u2504\u2504")} ${color(label)} ${c.subtle("\u2504".repeat(ruleLen))}`;
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
  const suffix = reason ? c.subtle(` \u2014 ${reason}`) : "";
  return `  ${icon} ${c.subtle(counter)} ${name}${" ".repeat(pad)}${c.subtle(elapsed)}${suffix}`;
}

// ── DAG result summary ──────────────────────────────────────────
// TODO: These formatters are adapted from the old engine WorkflowResult.
// They inspect node result data by name, which may need updating once
// the DAG node IDs settle.

export function formatDagResultHuman(results: Map<string, NodeResult>, durationMs: number, config?: CliConfig): string {
  const duration = formatDuration(durationMs);

  // Check for any failures
  for (const [nodeId, result] of results) {
    if (result.status === "failed") {
      return formatDagFailureResult(nodeId, result, duration);
    }
  }

  // Check for PR creation
  const createPrResult = results.get("create_pr");
  if (createPrResult?.data?.prUrl) {
    return formatDagSuccessResult(results, duration);
  }

  // Dry run — show findings summary, no side effects taken
  if (config?.dryRun) {
    return formatDagDryRunResult(results, duration);
  }

  // Issues created but no PR (fix too complex)
  const createIssueResult = results.get("create_issue");
  if (createIssueResult && createIssueResult.status === "success") {
    return formatDagIssuesCreatedResult(results, duration);
  }

  // No action / skip
  return formatDagNoActionResult(results, duration, config);
}

function formatDagSuccessResult(results: Map<string, NodeResult>, duration: string): string {
  const title = `${c.ok("\u2713")} ${chalk.bold("Triage Complete")}`;
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(duration);
  const header = [title + " ".repeat(Math.max(1, titlePad)) + c.subtle(duration)];

  const body: string[] = [];
  const issueData = results.get("create_issue")?.data;
  const prData = results.get("create_pr")?.data;

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

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

function formatDagIssuesCreatedResult(results: Map<string, NodeResult>, duration: string): string {
  const title = `${c.ok("\u2713")} ${chalk.bold("Issues Created")}`;
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(duration);
  const header = [title + " ".repeat(Math.max(1, titlePad)) + c.subtle(duration)];

  const body: string[] = [];
  const issueData = results.get("create_issue")?.data;

  if (issueData?.issueIdentifier) {
    body.push(`${c.subtle("Issue")}${" ".repeat(5)}${chalk.bold(String(issueData.issueIdentifier))}`);
    if (issueData.issueTitle) body.push(`${" ".repeat(10)}${String(issueData.issueTitle)}`);
    if (issueData.issueUrl) body.push(`${" ".repeat(10)}${c.link(String(issueData.issueUrl))}`);
    body.push("");
  }

  const investigateData = results.get("investigate")?.data;
  const rec = investigateData?.recommendation;
  if (rec) {
    body.push(`${c.subtle("Next")}${" ".repeat(6)}${String(rec)}`);
  }

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

function formatDagDryRunResult(results: Map<string, NodeResult>, duration: string): string {
  const title = `${c.ok("\u2713")} ${chalk.bold("Triage Complete (Dry Run)")}`;
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(duration);
  const header = [title + " ".repeat(Math.max(1, titlePad)) + c.subtle(duration)];

  const body: string[] = [];
  const investigateData = results.get("investigate")?.data;
  const findings = investigateData?.findings as Array<Record<string, unknown>> | undefined;
  const novelCount = investigateData?.novel_count as number | undefined;
  const severity = investigateData?.highest_severity as string | undefined;

  if (findings && findings.length > 0) {
    body.push(
      `${c.subtle("Findings")}${" ".repeat(2)}${chalk.bold(String(findings.length))} total, ${chalk.bold(String(novelCount ?? 0))} novel`,
    );
    if (severity) body.push(`${c.subtle("Severity")}${" ".repeat(2)}${chalk.bold(severity)}`);
    body.push("");
    for (const f of findings.slice(0, 5)) {
      const dup = f.is_duplicate ? c.subtle(" (dup)") : "";
      body.push(
        `  ${f.severity === "critical" || f.severity === "high" ? c.fail("\u25CF") : c.subtle("\u25CB")} ${String(f.title)}${dup}`,
      );
    }
    if (findings.length > 5) body.push(c.subtle(`  ... and ${findings.length - 5} more`));
    body.push("");
  }

  const rec = investigateData?.recommendation;
  if (rec) body.push(`${c.subtle("Next")}${" ".repeat(6)}${String(rec)}`);

  body.push("");
  body.push(c.subtle("No side effects — dry run mode"));

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

function formatDagFailureResult(nodeId: string, result: NodeResult, duration: string): string {
  const title = `${c.fail("\u2717")} ${chalk.bold("Workflow Failed")}`;
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(duration);
  const header = [title + " ".repeat(Math.max(1, titlePad)) + c.subtle(duration)];

  const body: string[] = [];
  body.push(`Failed at: ${chalk.bold(nodeId)}`);
  if (result.data?.error) {
    body.push("");
    body.push(String(result.data.error));
  }

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

function formatDagNoActionResult(results: Map<string, NodeResult>, duration: string, config?: CliConfig): string {
  const title = `${c.subtle("\u2212")} ${chalk.bold("No Action Needed")}`;
  const titlePad = BOX_WIDTH - 4 - visLen(title) - visLen(duration);
  const header = [title + " ".repeat(Math.max(1, titlePad)) + c.subtle(duration)];

  const body: string[] = [];
  const investigateData = results.get("investigate")?.data;

  const novelCount = investigateData?.novel_count;
  if (novelCount === 0) {
    body.push("All findings were duplicates of existing issues.");
  } else {
    const rec = investigateData?.recommendation;
    if (rec) body.push(`Recommendation: ${String(rec)}`);
    else body.push("No actionable issues detected.");
  }

  // Suggest widening the search when using narrow defaults
  const hints: string[] = [];
  if (!config?.timeRange || config.timeRange === "24h") {
    hints.push("--time-range 7d");
  }
  if (hints.length > 0) {
    body.push("");
    body.push(c.subtle(`Tip: try ${hints.join(" or ")} to widen the search`));
  }

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

// ── Validation errors ───────────────────────────────────────────
export function formatValidationErrors(errors: string[]): string {
  const title = `${c.fail("\u2717")} ${chalk.bold("Configuration Error")}`;
  const header = [title];

  const body: string[] = [];
  for (let i = 0; i < errors.length; i++) {
    if (i > 0) body.push("");
    body.push(`${c.subtle(`${i + 1}.`)} ${errors[i]}`);
  }

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom()].join("\n");
}

// ── Credential hint extraction ───────────────────────────────────
export function extractCredentialHint(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|unauthorized|authentication/i.test(msg) && /anthropic/i.test(msg)) {
    return "Check your ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN — get a key at https://console.anthropic.com";
  }
  if (/401|403|unauthorized/i.test(msg) && /datadog/i.test(msg)) {
    return "Check your DD_API_KEY and DD_APP_KEY — find them at https://app.datadoghq.com/organization-settings/api-keys";
  }
  if (/401|403|unauthorized/i.test(msg) && /linear/i.test(msg)) {
    return "Check your LINEAR_API_KEY — find it at https://linear.app/settings/api";
  }
  if (/401|403|unauthorized/i.test(msg) && /github/i.test(msg)) {
    return "Check your GITHUB_TOKEN — create a Personal Access Token at https://github.com/settings/tokens";
  }
  if (/ENOTFOUND|ETIMEDOUT|network/i.test(msg)) {
    return "Network error — check your internet connection and provider endpoint URL.";
  }
  return null;
}

// ── Crash error ─────────────────────────────────────────────────
export function formatCrashError(error: unknown): string {
  const msg = error instanceof Error ? error.message : "Unknown error";
  const title = `${c.fail("\u2717")} ${chalk.bold("Unexpected Error")}`;
  const header = [title];

  const hint = extractCredentialHint(error);
  const body: string[] = [
    msg,
    ...(hint ? ["", `${c.subtle("Hint:")} ${hint}`] : []),
    "",
    c.subtle("If this persists, please open an issue:"),
    c.link("https://github.com/swenyai/sweny/issues"),
  ];

  return ["", boxTop(), ...boxSection(header), boxDivider(), ...boxSection(body), boxBottom(), ""].join("\n");
}

// ── Check results ────────────────────────────────────────────────
export function formatCheckResults(results: CheckResult[]): string {
  const title = `${chalk.bold("Provider Connectivity Check")}`;
  const header = [title];

  const body: string[] = results.map((r) => {
    const icon = r.status === "ok" ? c.ok("\u2713") : r.status === "fail" ? c.fail("\u2717") : c.subtle("\u2212");
    const name = chalk.white(r.name);
    const detail =
      r.status === "ok" ? c.subtle(r.detail) : r.status === "fail" ? chalk.red(r.detail) : c.subtle(r.detail);
    return `${icon}  ${name}\n     ${detail}`;
  });

  const hasFailure = results.some((r) => r.status === "fail");
  const summary = hasFailure
    ? c.fail("One or more checks failed — fix the issues above before running sweny triage.")
    : results.every((r) => r.status === "skip")
      ? c.subtle("All providers set to file mode — no network checks performed.")
      : c.ok("All checks passed.");

  return [
    "",
    boxTop(),
    ...boxSection(header),
    boxDivider(),
    ...boxSection(body),
    boxDivider(),
    ...boxSection([summary]),
    boxBottom(),
    "",
  ].join("\n");
}

// ── JSON output ─────────────────────────────────────────────────
export function formatResultJson(results: Map<string, NodeResult>): string {
  return JSON.stringify(Object.fromEntries(results), null, 2);
}

// ── Helpers ─────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
