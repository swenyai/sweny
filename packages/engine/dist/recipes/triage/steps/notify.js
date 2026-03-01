import * as fs from "fs";
import { getStepData } from "../results.js";
/** Build summary and send notification with investigation results. */
export async function sendNotification(ctx) {
    const config = ctx.config;
    const notification = ctx.providers.get("notification");
    const investigation = getStepData(ctx, "investigate");
    const prData = getStepData(ctx, "create-pr");
    const issueData = getStepData(ctx, "create-issue");
    const crossRepoData = getStepData(ctx, "cross-repo-check");
    const implementResult = ctx.results.get("implement-fix");
    const lines = [];
    lines.push(`**Run Date**: ${new Date().toISOString()}`);
    lines.push(`**Service Filter**: \`${config.serviceFilter}\``);
    lines.push(`**Time Range**: \`${config.timeRange}\``);
    lines.push(`**Dry Run**: ${config.dryRun}`);
    lines.push(`**Recommendation**: ${investigation?.recommendation ?? "unknown"}`);
    lines.push("");
    // Issue reference
    const issueIdentifier = prData?.issueIdentifier ?? issueData?.issueIdentifier;
    const issueUrl = prData?.issueUrl ?? issueData?.issueUrl;
    if (issueIdentifier) {
        lines.push(`**Issue**: [${issueIdentifier}](${issueUrl})`);
        lines.push("");
    }
    // Status message
    if (crossRepoData?.dispatched) {
        lines.push(`> **Cross-repo dispatch**: Bug belongs to \`${crossRepoData.targetRepo}\` — dispatched for implementation`);
    }
    else if (investigation?.recommendation?.toLowerCase().includes("skip")) {
        lines.push("> **Skipped**: No novel issues found");
    }
    else if (investigation?.recommendation?.toLowerCase().includes("+1 existing")) {
        lines.push("> **+1 Existing**: Added occurrence to existing issue");
    }
    else if (implementResult?.status === "skipped" && implementResult.reason) {
        lines.push(`> **Skipped**: ${implementResult.reason}`);
    }
    else if (prData?.prUrl) {
        lines.push(`> **Success**: New PR created - ${prData.prUrl}`);
    }
    else if (config.dryRun) {
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
    await notification.send({
        title: "SWEny Triage Summary",
        body: lines.join("\n"),
        format: "markdown",
    });
    return { status: "success" };
}
//# sourceMappingURL=notify.js.map