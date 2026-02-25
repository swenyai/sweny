import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import * as exec from "@actions/exec";
import type { TriageHistoryEntry } from "@sweny/providers/issue-tracking";
import { ActionConfig } from "../config.js";
import { Providers } from "../providers/index.js";
import { installClaude, runClaude } from "../utils/claude.js";
import { parseServiceMap } from "../utils/service-map.js";

export interface InvestigationResult {
  issuesFound: boolean;
  bestCandidate: boolean;
  recommendation: string; // "implement" | "+1 existing ENG-XXX" | "skip"
  existingIssue: string; // e.g., "ENG-123" from +1 recommendation
  targetRepo: string; // e.g., "org/repo" for cross-repo dispatch
  shouldImplement: boolean; // recommendation starts with "implement"
}

export async function investigate(
  config: ActionConfig,
  providers: Providers,
): Promise<InvestigationResult> {
  const analysisDir = ".github/datadog-analysis";
  fs.mkdirSync(analysisDir, { recursive: true });

  // Install Claude
  await installClaude();

  // Verify provider access
  core.startGroup("Verify provider access");
  await providers.observability.verifyAccess();
  core.info("Observability provider access verified");
  await providers.issueTracker.verifyAccess();
  core.info("Issue tracker access verified");
  core.endGroup();

  // Build known issues context
  core.startGroup("Build known issues context");
  const knownIssuesContent = await buildKnownIssuesContext(config, providers);
  const knownIssuesPath = path.join(analysisDir, "known-issues-context.md");
  fs.writeFileSync(knownIssuesPath, knownIssuesContent);
  core.endGroup();

  // Build investigation prompt
  const prompt = buildInvestigationPrompt(config, knownIssuesContent);

  // Run Claude investigation
  core.startGroup("Claude investigation");
  const claudeEnv: Record<string, string> = {
    DD_API_KEY: config.ddApiKey,
    DD_APP_KEY: config.ddAppKey,
    DD_SITE: config.ddSite,
    LINEAR_API_KEY: config.linearApiKey,
    LINEAR_TEAM_ID: config.linearTeamId,
    LINEAR_BUG_LABEL_ID: config.linearBugLabelId,
  };
  if (config.anthropicApiKey)
    claudeEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.claudeOauthToken)
    claudeEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOauthToken;

  await runClaude({ prompt, maxTurns: config.maxInvestigateTurns, env: claudeEnv });
  core.endGroup();

  // Parse results
  return parseInvestigationResults(analysisDir);
}

// ---------------------------------------------------------------------------
// Build Known Issues Context
// ---------------------------------------------------------------------------

async function buildKnownIssuesContext(
  config: ActionConfig,
  providers: Providers,
): Promise<string> {
  const lines: string[] = [];

  lines.push("# Known Triage History (Last 30 Days)");
  lines.push("");
  lines.push(
    "These issues have already been identified by previous SWEny Triage runs.",
  );
  lines.push(
    "Do NOT create new issues or propose fixes for these same problems.",
  );
  lines.push("");

  // 1. Fetch recent triage Linear issues (last 30 days)
  lines.push("## Linear Issues");
  try {
    const triageHistory =
      await providers.issueTracker.listTriageHistory(
        config.linearTeamId,
        config.linearTriageLabelId,
        30,
      );

    if (triageHistory.length > 0) {
      for (const entry of triageHistory) {
        lines.push(
          `- **${entry.identifier}** [${entry.state}] ${entry.title} — ${entry.url}`,
        );
      }
    } else {
      lines.push("_No triage-labeled Linear issues found in last 30 days_");
    }
  } catch (err) {
    core.warning(`Failed to fetch Linear triage history: ${err}`);
    lines.push("_Failed to fetch Linear triage history_");
  }

  lines.push("");

  // 2. Fetch recent triage GitHub PRs
  lines.push("## GitHub PRs");

  interface GhPr {
    number: number;
    title: string;
    state: string;
    url: string;
    mergedAt: string | null;
    closedAt: string | null;
  }

  let triagePrs: GhPr[] = [];
  try {
    let output = "";
    await exec.exec(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        config.repository,
        "--label",
        "triage",
        "--state",
        "all",
        "--limit",
        "30",
        "--json",
        "number,title,state,url,mergedAt,closedAt",
      ],
      {
        listeners: {
          stdout: (data) => {
            output += data.toString();
          },
        },
        env: {
          ...process.env,
          GH_TOKEN: config.githubToken,
        } as Record<string, string>,
        ignoreReturnCode: true,
      },
    );
    triagePrs = JSON.parse(output.trim() || "[]") as GhPr[];
  } catch {
    core.warning("Failed to fetch GitHub triage PRs");
    triagePrs = [];
  }

  // Merged (fixed)
  lines.push("### Merged (fixed)");
  const merged = triagePrs.filter((pr) => pr.state === "MERGED");
  if (merged.length > 0) {
    for (const pr of merged) {
      lines.push(`- PR #${pr.number}: ${pr.title} — ${pr.url}`);
    }
  } else {
    lines.push("_None_");
  }

  // Open (in progress)
  lines.push("### Open (in progress)");
  const open = triagePrs.filter((pr) => pr.state === "OPEN");
  if (open.length > 0) {
    for (const pr of open) {
      lines.push(`- PR #${pr.number}: ${pr.title} — ${pr.url}`);
    }
  } else {
    lines.push("_None_");
  }

  // Closed (failed attempts)
  lines.push("### Closed (failed attempts)");
  const closed = triagePrs.filter((pr) => pr.state === "CLOSED");
  if (closed.length > 0) {
    for (const pr of closed) {
      lines.push(`- PR #${pr.number}: ${pr.title} — ${pr.url}`);
    }
  } else {
    lines.push("_None_");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Build Investigation Prompt
// ---------------------------------------------------------------------------

function buildInvestigationPrompt(
  config: ActionConfig,
  knownIssuesContent: string,
): string {
  const parts: string[] = [];

  // Dynamic inputs section (variable expansion)
  parts.push(`You are an autonomous SRE agent investigating production issues.
You have access to multiple tools and data sources. Your job is to investigate issues,
understand problems, and prepare fixes.

## CURRENT REPO
You are running inside: **${config.repository}**

## YOUR INPUTS - REVIEW THESE FIRST

### Linear Issue
${config.linearIssue || "(none provided)"}

### Additional Instructions
${config.additionalInstructions || "(none provided)"}

### Cross-Repo Dispatch
Dispatched from: (not dispatched — this is a direct run)
Context from dispatcher: (none)

### Investigation Parameters
- Service Pattern: ${config.serviceFilter}
- Time Range: ${config.timeRange}
- Focus Area: ${config.severityFocus}
- Investigation Depth: ${config.investigationDepth}

## DECIDE YOUR APPROACH

Based on the inputs above, decide how to proceed:

1. **If a Linear Issue is provided** (e.g., ENG-123):
   - Fetch the issue details and comments from Linear using the API
   - Understand what the issue is about and any context from comments
   - You may still query Datadog for related logs if helpful
   - Focus your investigation on this specific issue

2. **If Additional Instructions are provided**:
   - Follow them as your primary guide
   - They may tell you to skip log investigation, focus on specific areas, etc.
   - Use your judgment to combine with other inputs

3. **If neither is provided** (default mode):
   - Query Datadog for recent errors
   - Investigate the top issues
   - Identify the best candidate for fixing

4. **You can combine approaches** - e.g., work on a Linear issue AND check Datadog for related errors

## AVAILABLE TOOLS

### Datadog Logs API
- \`DD_API_KEY\` - API key (use in DD-API-KEY header)
- \`DD_APP_KEY\` - Application key (use in DD-APPLICATION-KEY header)
- \`DD_SITE\` - Datadog site (datadoghq.com)

**DO NOT make up data** - only use real data from APIs. If no data, report that honestly.

## Your Mission

Investigate logs from Datadog across **BOTH production AND staging environments** to find bugs and issues.
You have DIRECT ACCESS to Datadog's Logs API via curl commands.

**Key Insight**: Catching issues in staging BEFORE they hit production is extremely valuable!
- Issues in staging only → Fix before users are affected
- Issues in both environments → Critical, affects users now
- Issues in production only → May be load/scale related

## Datadog API Access

Use these environment variables in your curl commands:
- \`DD_API_KEY\` - API key (use in DD-API-KEY header)
- \`DD_APP_KEY\` - Application key (use in DD-APPLICATION-KEY header)
- \`DD_SITE\` - Datadog site (datadoghq.com)

### Example: Get error counts by service
\`\`\`bash
curl -s -X POST "https://api.\${DD_SITE}/api/v2/logs/analytics/aggregate" \\
  -H "Content-Type: application/json" \\
  -H "DD-API-KEY: \${DD_API_KEY}" \\
  -H "DD-APPLICATION-KEY: \${DD_APP_KEY}" \\
  -d '{"filter":{"query":"service:* status:error","from":"now-1h","to":"now"},"compute":[{"type":"total","aggregation":"count"}],"group_by":[{"facet":"service","limit":20,"sort":{"type":"measure","aggregation":"count","order":"desc"}}]}'
\`\`\`

### Example: Get recent error logs
\`\`\`bash
curl -s -X POST "https://api.\${DD_SITE}/api/v2/logs/events/search" \\
  -H "Content-Type: application/json" \\
  -H "DD-API-KEY: \${DD_API_KEY}" \\
  -H "DD-APPLICATION-KEY: \${DD_APP_KEY}" \\
  -d '{"filter":{"query":"service:* status:error","from":"now-1h","to":"now"},"sort":"-timestamp","page":{"limit":100}}'
\`\`\`

### Linear API
The \`LINEAR_API_KEY\` environment variable is set. Use the Linear GraphQL API directly via curl:

\`\`\`bash
# Get issue details by identifier (e.g., ENG-123)
curl -s -X POST "https://api.linear.app/graphql" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: \${LINEAR_API_KEY}" \\
  -d '{"query":"query { issueSearch(query: \\"ENG-123\\") { nodes { id identifier title description url state { name } } } }"}'

# Search for existing issues by title/keyword
curl -s -X POST "https://api.linear.app/graphql" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: \${LINEAR_API_KEY}" \\
  -d '{"query":"query { issueSearch(query: \\"search terms\\", filter: { team: { id: { eq: \\"\${LINEAR_TEAM_ID}\\" } } }) { nodes { id identifier title url state { name } } } }"}'
\`\`\`

**Environment variables available:**
- \`LINEAR_API_KEY\` - API key (already configured)
- \`LINEAR_TEAM_ID\` - Team ID
- \`LINEAR_BUG_LABEL_ID\` - Bug label ID

## SERVICE OWNERSHIP MAP

Read the service map at \`${config.serviceMapPath}\` to understand which GitHub repo
owns which Datadog service. This is critical for cross-repo dispatch.

**You MUST determine which repo should fix the bug you find.** Look at the Datadog service
name in the error logs and match it against the \`owns\` list in the service map.`);

  // Inject service map if it exists
  const serviceMap = parseServiceMap(config.serviceMapPath);
  if (serviceMap.services.length > 0) {
    parts.push("");
    parts.push("### Service Map Reference");
    // Read the raw file to include in prompt
    if (fs.existsSync(config.serviceMapPath)) {
      parts.push(fs.readFileSync(config.serviceMapPath, "utf-8"));
    }
  }

  // Target repo identification
  parts.push(`
## TARGET REPO IDENTIFICATION

**Required**: In your \`best-candidate.md\` output, include these lines near the top
(after the TRIAGE_FINGERPRINT and RECOMMENDATION):

\`\`\`
TARGET_SERVICE: <service-map key, e.g., my-service>
TARGET_REPO: <GitHub repo, e.g., my-org/my-service>
\`\`\`

- If the bug belongs to **this repo**, set TARGET_REPO to the current repo.
- If the bug belongs to **a different repo**, set TARGET_REPO to that repo.
  The workflow will automatically dispatch to the correct repo.`);

  // Known issues context
  if (knownIssuesContent) {
    parts.push(`
## KNOWN ISSUES - DO NOT DUPLICATE

The following issues and fixes have already been identified by previous triage runs.
Do NOT create new issues or propose fixes for the same underlying problems.
If the same error appears again, note it as a known issue and recommend a +1 on the existing issue instead.

${knownIssuesContent}`);
  }

  // Investigation parameters and output requirements
  parts.push(`
## Investigation Parameters

- **Service Pattern**: \`${config.serviceFilter}\`
- **Time Range**: \`${config.timeRange}\`
- **Focus Area**: \`${config.severityFocus}\`
- **Investigation Depth**: \`${config.investigationDepth}\`

## Output Requirements

Create these files with your findings:

### 1. \`.github/datadog-analysis/investigation-log.md\`
Document your investigation process - commands run, what you found, reasoning.

### 2. \`.github/datadog-analysis/issues-report.md\`
For each issue found:
- Severity, Environment (Production/Staging/Both), Frequency
- Description, Evidence (logs, stack traces)
- Root Cause Analysis, Impact, Suggested Fix
- Files to Modify, Confidence Level
- **Linear Status**: Check if this issue already exists in Linear
  - If exists: Note the issue identifier (e.g., ENG-123) and URL
  - If not found: Note as "No existing Linear issue found"

### 3. \`.github/datadog-analysis/best-candidate.md\`
Select the BEST issue to fix based on impact, frequency, fixability.
Include full technical analysis, exact code changes, test plan, rollback plan.

**CRITICAL - Title Format**: The first \`#\` heading in this file becomes the Linear issue title and PR title.
Do NOT prefix it with "Best Candidate Fix:", "Best Fix Candidate:", or any boilerplate.
Write a concise, descriptive bug title like you would for a real bug ticket. Examples:
- \`# extractUserFromResult Null Guard in EmitsEvent Decorator\`
- \`# SQS Message Retry Storm from Unhandled TypeError in Worker\`
- \`# PostgreSQL Vector Cast Syntax Error in Embedding Repository\`
Do NOT include backticks (\\\`) in the heading — they cause shell injection in CI.

**Important**: Include Linear Status at the top showing if this issue already exists:
- If exists: \`**Linear Issue**: [ENG-123](url) - Issue already tracked\`
- If not found: \`**Linear Issue**: None found - New issue will be created\`

**Required**: Include a TRIAGE_FINGERPRINT block in an HTML comment at the very top of best-candidate.md:
\`\`\`
<!-- TRIAGE_FINGERPRINT
error_pattern: <the key error message or pattern>
service: <service name>
first_seen: <date>
run_id: <github run id if available>
-->
\`\`\`

**Required**: Include a RECOMMENDATION line near the top (after the fingerprint):
- \`RECOMMENDATION: implement\` - This is a novel issue worth fixing
- \`RECOMMENDATION: +1 existing ENG-XXX\` - Same issue as an existing ticket, add occurrence
- \`RECOMMENDATION: skip\` - Not worth fixing (too minor, expected behavior, etc.)

## START NOW

1. Review your inputs above (Linear Issue, Additional Instructions, Parameters)
2. Decide your approach based on what was provided
3. Execute your investigation using the available APIs
4. Write the output files

**CRITICAL**: You MUST write the output files BEFORE you run out of turns.
Write files early and update them if needed. Do NOT keep investigating without writing files.

**If Additional Instructions tell you to do something specific, follow them.**`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Parse Investigation Results
// ---------------------------------------------------------------------------

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
      core.info(`Recommendation: ${recommendation}`);
    } else {
      // Default to "implement" if best candidate exists but no explicit recommendation
      recommendation = "implement";
      core.info(
        "No explicit RECOMMENDATION found in best-candidate.md, defaulting to implement",
      );
    }

    // Extract existing issue reference from "+1 existing" recommendation
    const existingMatch = recommendation.match(
      /\+1 existing\s+([A-Z]+-\d+)/i,
    );
    if (existingMatch) {
      existingIssue = existingMatch[1];
      core.info(`Existing issue reference: ${existingIssue}`);
    }

    // Extract TARGET_REPO
    const repoMatch = content.match(/^TARGET_REPO:\s*(.+)$/im);
    if (repoMatch) {
      targetRepo = repoMatch[1].trim();
      core.info(`Target repo: ${targetRepo}`);
    }
  } else {
    core.info("No best-candidate.md found, recommendation: skip");
  }

  const shouldImplement =
    recommendation.toLowerCase().startsWith("implement");

  return {
    issuesFound,
    bestCandidate,
    recommendation,
    existingIssue,
    targetRepo,
    shouldImplement,
  };
}
