#!/usr/bin/env npx tsx
/**
 * GitHub Summary Notification Provider
 *
 * Writes a triage summary to $GITHUB_STEP_SUMMARY.
 * This is the default notification provider — always available in GitHub Actions.
 */
import { readFileSync, appendFileSync } from "node:fs";

const args = process.argv.slice(2);

function getFlag(name: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : "";
}

const recommendation = getFlag("recommendation");
const issueId = getFlag("issue-id");
const issueUrl = getFlag("issue-url");
const prUrl = getFlag("pr-url");
const targetRepo = getFlag("target-repo");
const currentRepo = getFlag("current-repo");
const analysisDir = getFlag("analysis-dir") || ".github/datadog-analysis";
const serviceFilter = getFlag("service-filter");
const timeRange = getFlag("time-range");
const dryRun = getFlag("dry-run") === "true";
const dispatchedFrom = getFlag("dispatched-from");
const existingPrFound = getFlag("existing-pr-found") === "true";
const existingPrUrl = getFlag("existing-pr-url");

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (!summaryFile) {
  console.error("GITHUB_STEP_SUMMARY not set — not running in GitHub Actions?");
  process.exit(1);
}

function write(line: string): void {
  appendFileSync(summaryFile!, line + "\n");
}

write("## SWEny Triage Summary");
write("");
write(`**Run Date**: ${new Date().toISOString()}`);
write(`**Service Filter**: ${serviceFilter}`);
write(`**Time Range**: ${timeRange}`);
write(`**Dry Run**: ${dryRun}`);
write(`**Recommendation**: ${recommendation}`);
write("");

if (issueId) {
  write(`**Issue**: [${issueId}](${issueUrl})`);
}

if (targetRepo && targetRepo !== currentRepo) {
  write(`> **Cross-repo dispatch**: Bug belongs to \`${targetRepo}\` — dispatched for implementation`);
} else if (recommendation.toLowerCase().includes("skip")) {
  write("> **Skipped**: No novel issues found");
} else if (recommendation.toLowerCase().includes("+1 existing")) {
  write("> **+1 Existing**: Added occurrence to existing issue");
} else if (existingPrFound) {
  write(`> **Skipped**: Found existing PR - ${existingPrUrl}`);
} else if (prUrl) {
  write(`> **Success**: New PR created - ${prUrl}`);
} else if (dryRun) {
  write("> **Dry Run**: Analysis only");
}

if (dispatchedFrom) {
  write("");
  write(`**Dispatched from**: \`${dispatchedFrom}\``);
}

// Append investigation log if available
try {
  const log = readFileSync(`${analysisDir}/investigation-log.md`, "utf-8");
  write("");
  write("### Investigation Log");
  write(log);
} catch {
  // File not found — skip
}

// Append issues report if available
try {
  const report = readFileSync(`${analysisDir}/issues-report.md`, "utf-8");
  write("");
  write("### Issues Found");
  write(report);
} catch {
  // File not found — skip
}

console.log("Summary written to GITHUB_STEP_SUMMARY");
