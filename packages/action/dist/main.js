import * as core from "@actions/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { execute, ClaudeClient, createSkillMap, configuredSkills, buildAutoMcpServers, buildProviderContext, resolveTemplates, loadAdditionalContext, loadConfigFile, parseWorkflow, toMermaidBlock, } from "@sweny-ai/core";
import { triageWorkflow, implementWorkflow } from "@sweny-ai/core/workflows";
import { parseInputs, validateInputs } from "./config.js";
import { createCloudStreamReporter } from "./cloud-stream.js";
const actionsLogger = {
    info: core.info,
    debug: core.debug,
    warn: core.warning,
    error: core.error,
};
async function run() {
    const startTime = Date.now();
    try {
        const config = parseInputs();
        const validationErrors = validateInputs(config);
        if (validationErrors.length > 0) {
            core.setFailed(validationErrors.join("\n"));
            return;
        }
        // Populate process.env from action inputs so skills can resolve config via env vars
        populateEnv(config);
        // Build auto-injected MCP servers from provider config
        const mcpServers = buildAutoMcpServers({
            sourceControlProvider: config.sourceControlProvider,
            issueTrackerProvider: config.issueTrackerProvider,
            observabilityProvider: config.observabilityProvider,
            credentials: Object.fromEntries(Object.entries(process.env).filter((e) => e[1] != null)),
            workspaceTools: config.workspaceTools,
            userMcpServers: config.mcpServers,
        });
        // Build skill map from configured skills
        const skills = createSkillMap(configuredSkills());
        // Create Claude client with external MCP servers
        const claude = new ClaudeClient({
            maxTurns: config.workflow === "implement" ? config.maxImplementTurns : config.maxInvestigateTurns,
            cwd: process.cwd(),
            logger: actionsLogger,
            mcpServers,
        });
        // Select workflow — built-in or custom YAML file
        let workflow;
        if (config.workflow === "triage") {
            workflow = triageWorkflow;
        }
        else if (config.workflow === "implement") {
            workflow = implementWorkflow;
        }
        else {
            const workflowPath = path.resolve(process.cwd(), config.workflow);
            if (!fs.existsSync(workflowPath)) {
                core.setFailed(`Custom workflow file not found: ${config.workflow}`);
                return;
            }
            workflow = parseWorkflow(parseYaml(fs.readFileSync(workflowPath, "utf-8")));
            core.info(`Loaded custom workflow: ${config.workflow}`);
        }
        // Load .sweny.yml from repo root — same config the CLI reads
        const fileConfig = loadConfigFile(process.cwd());
        const fileRules = Array.isArray(fileConfig.rules) ? fileConfig.rules : [];
        const fileContext = Array.isArray(fileConfig.context) ? fileConfig.context : [];
        // Load templates & additional context
        const templates = await resolveTemplates({ issueTemplate: config.issueTemplate, prTemplate: config.prTemplate }, process.cwd());
        // Resolve rules from .sweny.yml (separate from context — gets "MUST follow" framing)
        const rulesResult = await loadAdditionalContext(fileRules, process.cwd());
        // Resolve context: .sweny.yml context + action additional-context merged
        const userContextResult = await loadAdditionalContext([...fileContext, ...config.additionalContext], process.cwd());
        // Build dynamic provider context
        const extras = {};
        if (config.observabilityCredentials.sourceId) {
            extras["BetterStack source ID"] = config.observabilityCredentials.sourceId;
        }
        if (config.observabilityCredentials.tableName) {
            extras["BetterStack table name"] = config.observabilityCredentials.tableName;
        }
        const providerCtx = buildProviderContext({
            observabilityProvider: config.observabilityProvider,
            issueTrackerProvider: config.issueTrackerProvider,
            sourceControlProvider: config.sourceControlProvider,
            mcpServers: Object.keys(mcpServers),
            extras: Object.keys(extras).length > 0 ? extras : undefined,
        });
        const contextParts = [providerCtx, userContextResult.resolved, config.additionalInstructions].filter(Boolean);
        const context = contextParts.join("\n\n");
        // Build workflow input
        const input = {
            ...buildWorkflowInput(config),
            ...templates,
            // Structured rules/context for executor (rules get "MUST follow" framing)
            ...(rulesResult.resolved ? { rules: rulesResult.resolved } : {}),
            ...(context ? { context } : {}),
            // URLs for the prepare node to fetch at runtime
            ...(rulesResult.urls.length > 0 ? { rulesUrls: rulesResult.urls } : {}),
            ...(userContextResult.urls.length > 0 ? { contextUrls: userContextResult.urls } : {}),
        };
        // Set up cloud streaming for live DAG visualization
        const [owner, repo] = (config.repository || process.env.GITHUB_REPOSITORY || "").split("/");
        const canStream = !!(config.projectToken || process.env.GITHUB_APP_INSTALLATION_ID);
        const cloudStream = canStream
            ? createCloudStreamReporter({
                cloudUrl: "https://cloud.sweny.ai",
                projectToken: config.projectToken,
                installationId: process.env.GITHUB_APP_INSTALLATION_ID,
                owner,
                repo,
            })
            : null;
        // Execute workflow
        const results = await execute(workflow, input, {
            skills,
            claude,
            observer: (event) => {
                handleEvent(event);
                cloudStream?.onEvent(event);
            },
            logger: actionsLogger,
        });
        // Wait for any in-flight streaming events
        await cloudStream?.flush();
        setGitHubOutputs(results);
        await writeJobSummary(results, config, workflow);
        // Report to SWEny Cloud if project token or GitHub App installation is available
        if (canStream) {
            await reportToCloud(config, results, startTime, cloudStream?.getRunId() ?? undefined);
        }
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
        else {
            core.setFailed("An unexpected error occurred");
        }
    }
}
/** Populate process.env from action inputs so skills can resolve config via env vars */
function populateEnv(config) {
    const set = (key, value) => {
        if (value)
            process.env[key] = value;
    };
    // Auth
    set("ANTHROPIC_API_KEY", config.anthropicApiKey);
    set("CLAUDE_CODE_OAUTH_TOKEN", config.claudeOauthToken);
    set("GITHUB_TOKEN", config.githubToken || config.botToken);
    // Issue tracker
    set("LINEAR_API_KEY", config.linearApiKey);
    set("LINEAR_TEAM_ID", config.linearTeamId);
    set("LINEAR_BUG_LABEL_ID", config.linearBugLabelId);
    // Observability — map from structured credentials to flat env vars
    const obs = config.observabilityCredentials;
    switch (config.observabilityProvider) {
        case "datadog":
            set("DD_API_KEY", obs.apiKey);
            set("DD_APP_KEY", obs.appKey);
            set("DD_SITE", obs.site);
            break;
        case "sentry":
            set("SENTRY_AUTH_TOKEN", obs.authToken);
            set("SENTRY_ORG", obs.organization);
            set("SENTRY_PROJECT", obs.project);
            break;
        case "cloudwatch":
            set("AWS_REGION", obs.region);
            set("CLOUDWATCH_LOG_GROUP_PREFIX", obs.logGroupPrefix);
            break;
        case "splunk":
            set("SPLUNK_URL", obs.baseUrl);
            set("SPLUNK_TOKEN", obs.token);
            break;
        case "elastic":
            set("ELASTIC_URL", obs.baseUrl);
            set("ELASTIC_API_KEY", obs.apiKey);
            break;
        case "newrelic":
            set("NR_API_KEY", obs.apiKey);
            set("NR_ACCOUNT_ID", obs.accountId);
            set("NR_REGION", obs.region);
            break;
        case "loki":
            set("LOKI_URL", obs.baseUrl);
            set("LOKI_API_KEY", obs.apiKey);
            set("LOKI_ORG_ID", obs.orgId);
            break;
        case "betterstack":
            set("BETTERSTACK_API_TOKEN", obs.apiToken);
            set("BETTERSTACK_SOURCE_ID", obs.sourceId);
            set("BETTERSTACK_TABLE_NAME", obs.tableName);
            break;
    }
    // Coding agent
    set("OPENAI_API_KEY", config.openaiApiKey);
    set("GEMINI_API_KEY", config.geminiApiKey);
    // Source control
    set("GITLAB_TOKEN", config.gitlabToken);
    set("GITLAB_URL", config.gitlabBaseUrl);
    // Jira
    set("JIRA_URL", config.jiraBaseUrl);
    set("JIRA_EMAIL", config.jiraEmail);
    set("JIRA_API_TOKEN", config.jiraApiToken);
    // Notification
    set("SLACK_WEBHOOK_URL", config.notificationWebhookUrl);
    set("SENDGRID_API_KEY", config.sendgridApiKey);
}
/** Build workflow input from action config */
function buildWorkflowInput(config) {
    return {
        timeRange: config.timeRange,
        severityFocus: config.severityFocus,
        serviceFilter: config.serviceFilter,
        investigationDepth: config.investigationDepth,
        dryRun: config.dryRun,
        reviewMode: config.reviewMode,
        noveltyMode: config.noveltyMode,
        repository: config.repository,
        baseBranch: config.baseBranch,
        prLabels: config.prLabels,
        issueOverride: config.linearIssue,
        additionalInstructions: config.additionalInstructions,
        serviceMapPath: config.serviceMapPath,
        issueTrackerName: config.issueTrackerProvider,
        projectId: config.linearTeamId,
        issueIdentifier: config.linearIssue,
        observabilityProvider: config.observabilityProvider,
        ...(config.observabilityCredentials.sourceId && {
            betterstackSourceId: config.observabilityCredentials.sourceId,
        }),
        ...(config.observabilityCredentials.tableName && {
            betterstackTableName: config.observabilityCredentials.tableName,
        }),
    };
}
/** Handle execution events — map to GitHub Actions log groups with full streaming detail */
function handleEvent(event) {
    switch (event.type) {
        case "workflow:start":
            core.info(`▲ ${event.workflow}`);
            break;
        case "node:enter":
            core.startGroup(`${event.node}: ${event.instruction.slice(0, 80)}`);
            core.info(`→ ${event.node}`);
            break;
        case "node:progress": {
            // node:progress events carry tool activity from all sources (including
            // external MCP servers like GitHub, Linear, BetterStack) which don't
            // emit the narrower tool:call / tool:result events.
            // Patterns emitted by claude.ts:
            //   "toolName (Ns)"        — tool in progress
            //   "summary text…"        — tool use summary
            const toolProgressMatch = event.message.match(/^(.+?) \((\d+)s\)$/);
            if (toolProgressMatch) {
                core.info(`  → ${toolProgressMatch[1]} (${toolProgressMatch[2]}s)`);
            }
            else {
                core.info(`  ↳ ${event.message}`);
            }
            break;
        }
        case "tool:call":
            core.info(`  → ${event.tool}(${summarizeInput(event.input)})`);
            break;
        case "tool:result":
            core.info(`  ✓ ${event.tool} → ${summarizeOutput(event.output)}`);
            break;
        case "node:exit":
            if (event.result.status === "failed") {
                core.error(`✗ ${event.node}: ${event.result.status}`);
                if (event.result.data?.error)
                    core.error(`  ${event.result.data.error}`);
            }
            else {
                core.info(`✓ ${event.node}: ${event.result.status} (${event.result.toolCalls.length} tool calls)`);
            }
            core.endGroup();
            break;
        case "route":
            core.info(`⤳ ${event.from} → ${event.to} (${event.reason})`);
            break;
        case "workflow:end": {
            const statuses = Object.entries(event.results)
                .map(([id, r]) => `${id}:${r.status}`)
                .join(", ");
            core.info(`▼ workflow complete — ${statuses}`);
            break;
        }
    }
}
/** Summarize tool input for logging (truncated, no secrets) */
function summarizeInput(input) {
    if (!input || typeof input !== "object")
        return "";
    const obj = input;
    const parts = [];
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") {
            parts.push(`${k}=${v.length > 60 ? v.slice(0, 59) + "…" : v}`);
        }
        else if (typeof v === "number" || typeof v === "boolean") {
            parts.push(`${k}=${v}`);
        }
    }
    return parts.join(", ");
}
/** Summarize tool output for logging (truncated) */
function summarizeOutput(output) {
    if (output === undefined || output === null)
        return "ok";
    if (typeof output === "string")
        return output.length > 120 ? output.slice(0, 119) + "…" : output;
    const s = JSON.stringify(output);
    return s.length > 120 ? s.slice(0, 119) + "…" : s;
}
/** Set GitHub Action outputs from execution results */
function setGitHubOutputs(results) {
    const investigateResult = results.get("investigate");
    if (investigateResult) {
        core.setOutput("issues-found", String(investigateResult.data.issuesFound ?? false));
        core.setOutput("recommendation", String(investigateResult.data.recommendation ?? "skip"));
    }
    const prResult = results.get("create_pr") ?? results.get("implement");
    const issueResult = results.get("create_issue") ?? results.get("create-issue");
    if (prResult) {
        core.setOutput("issue-identifier", String(prResult.data.issueIdentifier ?? ""));
        core.setOutput("issue-url", String(prResult.data.issueUrl ?? ""));
        core.setOutput("pr-url", String(prResult.data.prUrl ?? ""));
        core.setOutput("pr-number", String(prResult.data.prNumber ?? ""));
    }
    else if (issueResult) {
        core.setOutput("issue-identifier", String(issueResult.data.issueIdentifier ?? ""));
        core.setOutput("issue-url", String(issueResult.data.issueUrl ?? ""));
    }
}
/** Write a GitHub Actions job summary with structured triage results */
async function writeJobSummary(results, config, workflow) {
    const lines = [];
    const isDryRun = config.dryRun;
    // ── Header ────────────────────────────────────────────────────
    lines.push(`## ${isDryRun ? "🔍" : "▲"} SWEny Triage ${isDryRun ? "(Dry Run)" : "Report"}`);
    lines.push("");
    // ── Workflow diagram ──────────────────────────────────────────
    const state = {};
    for (const [nodeId, result] of results) {
        state[nodeId] = result.status === "success" ? "success" : result.status === "failed" ? "failed" : "skipped";
    }
    lines.push(toMermaidBlock(workflow, { state }));
    lines.push("");
    // ── Config table ──────────────────────────────────────────────
    lines.push("| Setting | Value |");
    lines.push("|---------|-------|");
    if (config.repository)
        lines.push(`| Repository | \`${config.repository}\` |`);
    lines.push(`| Observability | ${config.observabilityProvider} |`);
    lines.push(`| Issue Tracker | ${config.issueTrackerProvider} |`);
    lines.push(`| Time Range | ${config.timeRange} |`);
    lines.push(`| Mode | ${isDryRun ? "dry run" : "live"} |`);
    if (config.serviceFilter)
        lines.push(`| Service Filter | \`${config.serviceFilter}\` |`);
    lines.push("");
    // ── Workflow path ─────────────────────────────────────────────
    const nodeNames = [...results.keys()];
    lines.push(`**Workflow path:** ${nodeNames.map((n) => `\`${n}\``).join(" → ")}`);
    lines.push("");
    // ── Findings ──────────────────────────────────────────────────
    const investigateData = results.get("investigate")?.data;
    const findings = investigateData?.findings;
    const novelCount = investigateData?.novel_count ?? 0;
    const severity = investigateData?.highest_severity;
    if (findings && findings.length > 0) {
        lines.push("### Findings");
        lines.push("");
        lines.push(`**${findings.length}** finding(s), **${novelCount}** novel, highest severity: **${severity ?? "unknown"}**`);
        lines.push("");
        lines.push("| # | Title | Severity | Complexity | Status |");
        lines.push("|---|-------|----------|------------|--------|");
        for (let i = 0; i < findings.length; i++) {
            const f = findings[i];
            const status = f.is_duplicate ? `dup of ${f.duplicate_of ?? "existing"}` : "novel";
            lines.push(`| ${i + 1} | ${f.title ?? "—"} | ${f.severity ?? "—"} | ${f.fix_complexity ?? "—"} | ${status} |`);
        }
        lines.push("");
    }
    else if (investigateData) {
        lines.push("### Findings");
        lines.push("");
        lines.push("No actionable findings detected.");
        lines.push("");
    }
    // ── Actions taken ─────────────────────────────────────────────
    const issueData = results.get("create_issue")?.data;
    const prData = results.get("create_pr")?.data;
    const skipData = results.get("skip")?.data;
    if (issueData || prData) {
        lines.push("### Actions Taken");
        lines.push("");
        if (issueData?.issueIdentifier) {
            const url = issueData.issueUrl;
            const title = issueData.issueTitle;
            const link = url ? `[${issueData.issueIdentifier}](${url})` : String(issueData.issueIdentifier);
            lines.push(`- **Issue created:** ${link}${title ? ` — ${title}` : ""}`);
        }
        if (prData?.prUrl) {
            const link = `[#${prData.prNumber ?? ""}](${prData.prUrl})`;
            lines.push(`- **PR opened:** ${link}`);
        }
        lines.push("");
    }
    else if (skipData) {
        lines.push("### Result");
        lines.push("");
        lines.push("No action taken — all findings were duplicates or low priority.");
        lines.push("");
    }
    // ── Dry run notice ────────────────────────────────────────────
    if (isDryRun) {
        lines.push("> **Dry run mode** — no issues, PRs, or notifications were created.");
        lines.push("");
    }
    // ── Recommendation ────────────────────────────────────────────
    const rec = investigateData?.recommendation;
    if (rec) {
        lines.push(`**Recommendation:** ${rec}`);
        lines.push("");
    }
    // ── Node details (collapsible) ────────────────────────────────
    lines.push("<details><summary>Node execution details</summary>");
    lines.push("");
    for (const [nodeId, result] of results) {
        const status = result.status === "success" ? "✓" : result.status === "failed" ? "✗" : "—";
        lines.push(`#### ${status} \`${nodeId}\` (${result.toolCalls.length} tool calls)`);
        lines.push("");
        if (result.toolCalls.length > 0) {
            lines.push("| Tool | Input (truncated) |");
            lines.push("|------|-------------------|");
            for (const tc of result.toolCalls.slice(0, 20)) {
                const input = summarizeInput(tc.input);
                lines.push(`| \`${tc.tool}\` | ${input.slice(0, 100) || "—"} |`);
            }
            if (result.toolCalls.length > 20) {
                lines.push(`| ... | ${result.toolCalls.length - 20} more tool calls |`);
            }
            lines.push("");
        }
    }
    lines.push("</details>");
    lines.push("");
    // Write to GITHUB_STEP_SUMMARY
    const md = lines.join("\n");
    await core.summary.addRaw(md).write();
}
// ─── Cloud Reporting ────────────────────────────────────────────
function getPrNumber() {
    if (process.env.GITHUB_EVENT_NAME !== "pull_request")
        return undefined;
    const match = process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)/);
    return match ? Number(match[1]) : undefined;
}
async function reportToCloud(config, results, startTime, streamRunId) {
    const cloudUrl = "https://cloud.sweny.ai";
    const investigateResult = results.get("investigate");
    const prResult = results.get("create_pr");
    const issueResult = results.get("create_issue");
    const prNumber = getPrNumber();
    const [owner, repo] = (config.repository || process.env.GITHUB_REPOSITORY || "").split("/");
    const body = {
        // Repo identification (for installation auth)
        owner,
        repo,
        // If we have a run_id from streaming, update instead of insert
        ...(streamRunId ? { run_id: streamRunId } : {}),
        // Run data
        status: [...results.values()].some((r) => r.status === "failed") ? "failed" : "completed",
        workflow: config.workflow,
        trigger: process.env.GITHUB_EVENT_NAME ?? "manual",
        pr_number: prNumber,
        branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME,
        commit_sha: process.env.GITHUB_SHA,
        duration_ms: Date.now() - startTime,
        issues_found: investigateResult?.data?.issuesFound ?? false,
        recommendation: investigateResult?.data?.recommendation ?? "skip",
        issue_url: (issueResult?.data?.issueUrl ?? prResult?.data?.issueUrl),
        pr_url: prResult?.data?.prUrl,
        issue_identifier: (issueResult?.data?.issueIdentifier ?? prResult?.data?.issueIdentifier),
        // Rich findings data from the investigate node
        findings: investigateResult?.data?.findings ?? [],
        highest_severity: investigateResult?.data?.highest_severity ?? null,
        novel_count: investigateResult?.data?.novel_count ?? 0,
        nodes: [...results.entries()].map(([id, r]) => ({
            id,
            name: id,
            status: r.status,
            durationMs: 0,
        })),
        action_version: "4",
        runner_os: process.env.RUNNER_OS,
    };
    // Build auth headers — prefer project token, fall back to installation ID
    const headers = { "Content-Type": "application/json" };
    if (config.projectToken) {
        headers.Authorization = `Bearer ${config.projectToken}`;
    }
    else {
        // When the SWEny GitHub App is installed, GITHUB_APP_INSTALLATION_ID may be available
        // Also check the token permissions context for app installation
        const installId = process.env.GITHUB_APP_INSTALLATION_ID;
        if (installId) {
            headers["X-GitHub-Installation-Id"] = installId;
        }
    }
    try {
        const res = await fetch(`${cloudUrl}/api/report`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        if (res.ok) {
            const data = (await res.json());
            core.info(`\u2601 Reported to SWEny Cloud: ${data.run_url ?? "ok"}`);
            // Post PR comment if we got one back and this is a PR run
            if (data.comment && prNumber) {
                await postPrComment(config, prNumber, data.comment);
            }
        }
        else {
            core.warning(`\u2601 Cloud reporting failed: ${res.status}`);
        }
    }
    catch (err) {
        core.warning(`\u2601 Cloud reporting failed: ${err}`);
    }
}
async function postPrComment(config, prNumber, body) {
    const token = config.botToken || config.githubToken;
    if (!token)
        return;
    const repo = config.repository || process.env.GITHUB_REPOSITORY;
    if (!repo)
        return;
    const apiBase = `https://api.github.com/repos/${repo}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
    };
    try {
        // Check for existing SWEny comment to update (avoid duplicates)
        const listRes = await fetch(`${apiBase}/issues/${prNumber}/comments?per_page=50`, { headers });
        if (!listRes.ok) {
            core.warning("\u2601 Failed to list PR comments");
            return;
        }
        const comments = (await listRes.json());
        const existing = comments.find((c) => c.body.includes("SWEny Triage Report"));
        if (existing) {
            await fetch(`${apiBase}/issues/comments/${existing.id}`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ body }),
            });
            core.info(`\u2601 Updated SWEny comment on PR #${prNumber}`);
        }
        else {
            await fetch(`${apiBase}/issues/${prNumber}/comments`, {
                method: "POST",
                headers,
                body: JSON.stringify({ body }),
            });
            core.info(`\u2601 Posted SWEny comment on PR #${prNumber}`);
        }
    }
    catch {
        core.warning("\u2601 Failed to post PR comment");
    }
}
run();
//# sourceMappingURL=main.js.map