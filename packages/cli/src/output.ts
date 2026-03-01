import chalk from "chalk";
import type { WorkflowResult } from "@swenyai/engine";

export function formatResultHuman(result: WorkflowResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold("Result"));
  lines.push("\u2500".repeat(50));

  // Status with color
  const statusColor =
    result.status === "completed" ? chalk.green : result.status === "partial" ? chalk.yellow : chalk.red;
  lines.push(`  Status:   ${statusColor(result.status)}`);
  lines.push(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);
  lines.push("");

  // Step table
  lines.push(chalk.bold("Steps:"));
  for (const step of result.steps) {
    const icon =
      step.result.status === "success"
        ? chalk.green("OK")
        : step.result.status === "skipped"
          ? chalk.dim("SKIP")
          : chalk.red("FAIL");
    const reason = step.result.reason ? chalk.dim(` \u2014 ${step.result.reason}`) : "";
    lines.push(`  ${chalk.dim(step.phase.padEnd(7))} ${step.name.padEnd(20)} ${icon}${reason}`);
  }

  // Key outputs
  const prData = result.steps.find((s) => s.name === "create-pr")?.result.data as Record<string, unknown> | undefined;
  const issueData = result.steps.find((s) => s.name === "create-issue")?.result.data as
    | Record<string, unknown>
    | undefined;
  if (prData?.prUrl || issueData?.issueUrl) {
    lines.push("");
    lines.push(chalk.bold("Outputs:"));
    if (issueData?.issueUrl) lines.push(`  Issue: ${String(issueData.issueUrl)}`);
    if (prData?.prUrl) lines.push(`  PR:    ${String(prData.prUrl)}`);
  }

  // Investigation summary
  const investigateData = result.steps.find((s) => s.name === "investigate")?.result.data as
    | Record<string, unknown>
    | undefined;
  if (investigateData) {
    lines.push("");
    lines.push(chalk.bold("Investigation:"));
    lines.push(`  Issues found:    ${String(investigateData.issuesFound ?? "unknown")}`);
    lines.push(`  Recommendation:  ${String(investigateData.recommendation ?? "unknown")}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function formatResultJson(result: WorkflowResult): string {
  return JSON.stringify(result, null, 2);
}
