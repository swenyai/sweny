import * as fs from "fs";
import * as path from "path";
import type { ObservabilityProvider } from "@swenyai/providers/observability";
import type { CodingAgent } from "@swenyai/providers/coding-agent";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig, InvestigationResult } from "../types.js";
import { getStepData } from "../results.js";
import { buildInvestigationPrompt } from "../prompts.js";

/** Run Claude coding agent to investigate production issues and parse results. */
export async function investigate(ctx: WorkflowContext<TriageConfig>): Promise<StepResult> {
  const config = ctx.config;
  const analysisDir = config.analysisDir ?? ".github/triage-analysis";
  const observability = ctx.providers.get<ObservabilityProvider>("observability");
  const codingAgent = ctx.providers.get<CodingAgent>("codingAgent");

  fs.mkdirSync(analysisDir, { recursive: true });

  // Install coding agent CLI
  await codingAgent.install();

  // Get known issues context from prior step
  const knownIssuesContent = getStepData(ctx, "build-context")?.knownIssuesContent ?? "";

  // Write known issues file for reference
  const knownIssuesPath = path.join(analysisDir, "known-issues-context.md");
  fs.writeFileSync(knownIssuesPath, knownIssuesContent);

  // Build investigation prompt
  const prompt = buildInvestigationPrompt(config, observability, knownIssuesContent);

  // Run coding agent investigation
  await codingAgent.run({
    prompt,
    maxTurns: config.maxInvestigateTurns,
    env: { ...config.agentEnv },
  });

  // Parse results
  const result = parseInvestigationResults(analysisDir);

  return {
    status: "success",
    data: { ...result },
  };
}

function parseInvestigationResults(analysisDir: string): InvestigationResult {
  const issuesReportPath = path.join(analysisDir, "issues-report.md");
  const bestCandidatePath = path.join(analysisDir, "best-candidate.md");

  const issuesFound = fs.existsSync(issuesReportPath);
  const bestCandidate = fs.existsSync(bestCandidatePath);

  let recommendation = "skip";
  let existingIssue = "";
  let targetRepo = "";

  if (bestCandidate) {
    const content = fs.readFileSync(bestCandidatePath, "utf-8");

    // Extract RECOMMENDATION
    const recMatch = content.match(/^RECOMMENDATION:\s*(.+)$/im);
    if (recMatch) {
      recommendation = recMatch[1].trim();
    } else {
      // Default to "implement" if best candidate exists but no explicit recommendation
      recommendation = "implement";
    }

    // Extract existing issue reference from "+1 existing" recommendation
    const existingMatch = recommendation.match(/\+1 existing\s+([A-Z]+-\d+)/i);
    if (existingMatch) {
      existingIssue = existingMatch[1];
    }

    // Extract TARGET_REPO
    const repoMatch = content.match(/^TARGET_REPO:\s*(.+)$/im);
    if (repoMatch) {
      targetRepo = repoMatch[1].trim();
    }
  }

  const shouldImplement = recommendation.toLowerCase().startsWith("implement");

  return {
    issuesFound,
    bestCandidate,
    recommendation,
    existingIssue,
    targetRepo,
    shouldImplement,
  };
}
