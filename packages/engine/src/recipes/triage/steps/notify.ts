import * as fs from "node:fs";
import type {
  NotificationProvider,
  NotificationField,
  NotificationLink,
  NotificationSection,
  NotificationStatus,
} from "@sweny-ai/providers/notification";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";
import { getStepData } from "../results.js";

/** Build summary and send notification with investigation results. */
export async function sendNotification(ctx: WorkflowContext<TriageConfig>): Promise<StepResult> {
  const config = ctx.config;
  const notification = ctx.providers.get<NotificationProvider>("notification");
  const investigation = getStepData(ctx, "investigate");
  const prData = getStepData(ctx, "create-pr");
  const issueData = getStepData(ctx, "create-issue");
  const crossRepoData = getStepData(ctx, "cross-repo-check");
  const implementResult = ctx.results.get("implement-fix");

  // -------------------------------------------------------------------------
  // Determine status and one-line summary
  // -------------------------------------------------------------------------
  let status: NotificationStatus;
  let summary: string;

  if (crossRepoData?.dispatched) {
    status = "info";
    summary = `Cross-repo dispatch: Bug belongs to \`${crossRepoData.targetRepo}\` — dispatched for implementation`;
  } else if (investigation?.recommendation?.toLowerCase().includes("skip")) {
    status = "skipped";
    summary = "Skipped: No novel issues found";
  } else if (investigation?.recommendation?.toLowerCase().includes("+1 existing")) {
    status = "info";
    summary = "+1 Existing: Added occurrence to existing issue";
  } else if (implementResult?.status === "skipped" && implementResult.reason) {
    status = "skipped";
    summary = `Skipped: ${implementResult.reason}`;
  } else if (prData?.prUrl) {
    status = "success";
    summary = `Success: New PR created — ${prData.prUrl}`;
  } else if (config.dryRun) {
    status = "info";
    summary = "Dry Run: Analysis only";
  } else {
    status = "info";
    summary = "Completed";
  }

  // -------------------------------------------------------------------------
  // Metadata fields
  // -------------------------------------------------------------------------
  const issueIdentifier = prData?.issueIdentifier ?? issueData?.issueIdentifier;
  const issueUrl = prData?.issueUrl ?? issueData?.issueUrl;

  const fields: NotificationField[] = [
    { label: "Run Date", value: new Date().toISOString(), short: true },
    { label: "Service Filter", value: `\`${config.serviceFilter}\``, short: true },
    { label: "Time Range", value: `\`${config.timeRange}\``, short: true },
    { label: "Dry Run", value: String(config.dryRun), short: true },
    { label: "Recommendation", value: investigation?.recommendation ?? "unknown", short: true },
  ];

  // -------------------------------------------------------------------------
  // Action links
  // -------------------------------------------------------------------------
  const links: NotificationLink[] = [];
  if (issueIdentifier && issueUrl) {
    links.push({ label: `Issue: ${issueIdentifier}`, url: issueUrl });
  }
  if (prData?.prUrl) {
    links.push({ label: `PR #${prData.prNumber}`, url: prData.prUrl });
  }

  // -------------------------------------------------------------------------
  // Content sections (from analysis files)
  // -------------------------------------------------------------------------
  const analysisDir = config.analysisDir ?? ".github/triage-analysis";
  const sections: NotificationSection[] = [];

  const investigationLog = `${analysisDir}/investigation-log.md`;
  if (fs.existsSync(investigationLog)) {
    sections.push({ title: "Investigation Log", content: fs.readFileSync(investigationLog, "utf-8") });
  }

  const issuesReport = `${analysisDir}/issues-report.md`;
  if (fs.existsSync(issuesReport)) {
    sections.push({ title: "Issues Found", content: fs.readFileSync(issuesReport, "utf-8") });
  }

  // -------------------------------------------------------------------------
  // Flat markdown body (fallback for providers that don't use structured fields)
  // -------------------------------------------------------------------------
  const lines: string[] = [];

  lines.push(`**Run Date**: ${new Date().toISOString()}`);
  lines.push(`**Service Filter**: \`${config.serviceFilter}\``);
  lines.push(`**Time Range**: \`${config.timeRange}\``);
  lines.push(`**Dry Run**: ${config.dryRun}`);
  lines.push(`**Recommendation**: ${investigation?.recommendation ?? "unknown"}`);
  lines.push("");

  if (issueIdentifier && issueUrl) {
    lines.push(`**Issue**: [${issueIdentifier}](${issueUrl})`);
    lines.push("");
  }

  lines.push(`> **${summary}**`);

  for (const section of sections) {
    lines.push("");
    lines.push(`### ${section.title}`);
    lines.push(section.content);
  }

  // -------------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------------
  await notification.send({
    title: "SWEny Triage Summary",
    body: lines.join("\n"),
    format: "markdown",
    status,
    summary,
    fields,
    sections,
    links,
  });

  return { status: "success" };
}
