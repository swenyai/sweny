import * as fs from "fs";
import type { ObservabilityProvider } from "@sweny/providers/observability";
import type { TriageConfig } from "./types.js";
import { parseServiceMap } from "./service-map.js";

// ---------------------------------------------------------------------------
// Investigation Prompt
// ---------------------------------------------------------------------------

export function buildInvestigationPrompt(
  config: TriageConfig,
  observability: ObservabilityProvider,
  knownIssuesContent: string,
): string {
  const parts: string[] = [];

  parts.push(`You are an autonomous SRE agent investigating production issues.
You have access to multiple tools and data sources. Your job is to investigate issues,
understand problems, and prepare fixes.

## CURRENT REPO
You are running inside: **${config.repository}**

## YOUR INPUTS - REVIEW THESE FIRST

### Linear Issue
${config.issueOverride || "(none provided)"}

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
   - You may still query the observability provider for related logs if helpful
   - Focus your investigation on this specific issue

2. **If Additional Instructions are provided**:
   - Follow them as your primary guide
   - They may tell you to skip log investigation, focus on specific areas, etc.
   - Use your judgment to combine with other inputs

3. **If neither is provided** (default mode):
   - Query the observability provider for recent errors
   - Investigate the top issues
   - Identify the best candidate for fixing

4. **You can combine approaches** - e.g., work on a Linear issue AND check observability logs for related errors

## AVAILABLE TOOLS

${observability.getPromptInstructions()}

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
owns which service. This is critical for cross-repo dispatch.

**You MUST determine which repo should fix the bug you find.** Look at the service
name in the error logs and match it against the \`owns\` list in the service map.`);

  // Inject service map if it exists
  const serviceMap = parseServiceMap(config.serviceMapPath);
  if (serviceMap.services.length > 0) {
    parts.push("");
    parts.push("### Service Map Reference");
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

### 1. \`.github/triage-analysis/investigation-log.md\`
Document your investigation process - commands run, what you found, reasoning.

### 2. \`.github/triage-analysis/issues-report.md\`
For each issue found:
- Severity, Environment (Production/Staging/Both), Frequency
- Description, Evidence (logs, stack traces)
- Root Cause Analysis, Impact, Suggested Fix
- Files to Modify, Confidence Level
- **Linear Status**: Check if this issue already exists in Linear
  - If exists: Note the issue identifier (e.g., ENG-123) and URL
  - If not found: Note as "No existing Linear issue found"

### 3. \`.github/triage-analysis/best-candidate.md\`
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
// Implementation Prompt
// ---------------------------------------------------------------------------

export function buildImplementPrompt(issueIdentifier: string): string {
  return `You are implementing a fix for an issue identified from production logs.

## Context

Read the best candidate analysis at \`.github/triage-analysis/best-candidate.md\`.
Also read \`.github/triage-analysis/investigation-log.md\` for context.

## Your Task

1. **Understand the issue**: Read the analysis thoroughly
2. **Verify the fix approach**: Check the codebase to ensure the suggested fix is valid
3. **Implement the fix**:
   - Make minimal, focused changes
   - Follow existing code patterns
   - Add appropriate error handling
   - Include TypeScript types
   - Do NOT add unnecessary comments
   - Do NOT refactor unrelated code

4. **Verify your changes**:
   - Run \`npm run lint\` to check for issues
   - Run \`npm run build\` to verify compilation

5. **Create a commit** with format:
   \`\`\`
   fix(<scope>): <brief description>

   - <change 1>
   - <change 2>

   Identified by SWEny Triage
   Linear: ${issueIdentifier}
   \`\`\`

## Safety Guidelines

- If the fix is too complex or risky, create \`.github/triage-analysis/fix-declined.md\` explaining why
- Do not make breaking changes
- Prefer defensive coding patterns

Start by reading the best-candidate.md file.`;
}

// ---------------------------------------------------------------------------
// PR Description Prompt
// ---------------------------------------------------------------------------

export function buildPrDescriptionPrompt(issueIdentifier: string, issueUrl: string): string {
  return `Generate a pull request description.

## Context

1. Read \`.github/triage-analysis/best-candidate.md\` for issue details
2. Read \`.github/triage-analysis/investigation-log.md\` for context
3. Run \`git diff main..HEAD\` to see the changes made

## Output

Create \`.github/triage-analysis/pr-description.md\` with:

## Summary
<What this PR fixes and why>

## Issue Analysis
- Severity, Frequency, Services affected, Impact

## Root Cause
<Technical explanation>

## Solution
<Description and changes made>

## Testing
- [ ] Lint passes
- [ ] Build passes
- [ ] Tests pass

## Rollback Plan
<How to rollback>

---
**Linear Issue**: [${issueIdentifier}](${issueUrl})
> Generated by SWEny Triage`;
}
