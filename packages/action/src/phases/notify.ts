import * as fs from "fs";
import { ActionConfig } from "../config.js";
import { Providers } from "../providers/index.js";
import { InvestigationResult } from "./investigate.js";
import { ImplementResult } from "./implement.js";

export async function notify(
  config: ActionConfig,
  providers: Providers,
  investigation: InvestigationResult,
  implementation?: ImplementResult,
): Promise<void> {
  const lines: string[] = [];

  lines.push(`**Run Date**: ${new Date().toISOString()}`);
  lines.push(`**Service Filter**: \`${config.serviceFilter}\``);
  lines.push(`**Time Range**: \`${config.timeRange}\``);
  lines.push(`**Dry Run**: ${config.dryRun}`);
  lines.push(`**Recommendation**: ${investigation.recommendation}`);
  lines.push("");

  if (implementation?.issueIdentifier) {
    lines.push(
      `**Linear Issue**: [${implementation.issueIdentifier}](${implementation.issueUrl})`,
    );
    lines.push("");
  }

  // Status message
  if (
    investigation.targetRepo &&
    investigation.targetRepo !== config.repository
  ) {
    lines.push(
      `> **Cross-repo dispatch**: Bug belongs to \`${investigation.targetRepo}\` — dispatched for implementation`,
    );
  } else if (investigation.recommendation.toLowerCase().includes("skip")) {
    lines.push("> **Skipped**: No novel issues found");
  } else if (
    investigation.recommendation.toLowerCase().includes("+1 existing")
  ) {
    lines.push("> **+1 Existing**: Added occurrence to existing issue");
  } else if (implementation?.skipped && implementation.skipReason) {
    lines.push(`> **Skipped**: ${implementation.skipReason}`);
  } else if (implementation?.prUrl) {
    lines.push(`> **Success**: New PR created - ${implementation.prUrl}`);
  } else if (config.dryRun) {
    lines.push("> **Dry Run**: Analysis only");
  }

  // Append investigation log if it exists
  const investigationLog = ".github/triage-analysis/investigation-log.md";
  if (fs.existsSync(investigationLog)) {
    lines.push("");
    lines.push("### Investigation Log");
    lines.push(fs.readFileSync(investigationLog, "utf-8"));
  }

  // Append issues report if it exists
  const issuesReport = ".github/triage-analysis/issues-report.md";
  if (fs.existsSync(issuesReport)) {
    lines.push("");
    lines.push("### Issues Found");
    lines.push(fs.readFileSync(issuesReport, "utf-8"));
  }

  await providers.notification.send({
    title: "SWEny Triage Summary",
    body: lines.join("\n"),
    format: "markdown",
  });
}
