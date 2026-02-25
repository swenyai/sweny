import * as core from "@actions/core";
import * as fs from "fs";
import { ActionConfig } from "../config";
import { InvestigationResult } from "./investigate";
import { ImplementResult } from "./implement";

export async function notify(
  config: ActionConfig,
  investigation: InvestigationResult,
  implementation?: ImplementResult,
): Promise<void> {
  const summary = core.summary
    .addHeading("SWEny Triage Summary", 2)
    .addRaw(
      `**Run Date**: ${new Date().toISOString()}\n`,
    )
    .addRaw(`**Service Filter**: \`${config.serviceFilter}\`\n`)
    .addRaw(`**Time Range**: \`${config.timeRange}\`\n`)
    .addRaw(`**Dry Run**: ${config.dryRun}\n`)
    .addRaw(`**Recommendation**: ${investigation.recommendation}\n\n`);

  // Add implementation results — Linear issue link
  if (implementation?.issueIdentifier) {
    summary.addRaw(
      `**Linear Issue**: [${implementation.issueIdentifier}](${implementation.issueUrl})\n`,
    );
  }

  // Status message
  if (
    investigation.targetRepo &&
    investigation.targetRepo !== config.repository
  ) {
    summary.addQuote(
      `**Cross-repo dispatch**: Bug belongs to \`${investigation.targetRepo}\` — dispatched for implementation`,
    );
  } else if (investigation.recommendation.toLowerCase().includes("skip")) {
    summary.addQuote("**Skipped**: No novel issues found");
  } else if (
    investigation.recommendation.toLowerCase().includes("+1 existing")
  ) {
    summary.addQuote(
      "**+1 Existing**: Added occurrence to existing issue",
    );
  } else if (implementation?.skipped && implementation.skipReason) {
    summary.addQuote(`**Skipped**: ${implementation.skipReason}`);
  } else if (implementation?.prUrl) {
    summary.addQuote(
      `**Success**: New PR created - ${implementation.prUrl}`,
    );
  } else if (config.dryRun) {
    summary.addQuote("**Dry Run**: Analysis only");
  }

  // Append investigation log if it exists
  const investigationLog = ".github/datadog-analysis/investigation-log.md";
  if (fs.existsSync(investigationLog)) {
    summary.addHeading("Investigation Log", 3);
    summary.addRaw(fs.readFileSync(investigationLog, "utf-8"));
  }

  // Append issues report if it exists
  const issuesReport = ".github/datadog-analysis/issues-report.md";
  if (fs.existsSync(issuesReport)) {
    summary.addHeading("Issues Found", 3);
    summary.addRaw(fs.readFileSync(issuesReport, "utf-8"));
  }

  await summary.write();
}
