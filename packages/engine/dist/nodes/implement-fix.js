import * as fs from "node:fs";
import { getStepData } from "../recipes/triage/results.js";
import { buildImplementPrompt } from "../recipes/triage/prompts.js";
/** Create branch, run Claude to implement fix, check for changes, and push. */
export async function implementFix(ctx) {
    const config = ctx.config;
    const analysisDir = config.analysisDir ?? ".github/triage-analysis";
    const sourceControl = ctx.providers.get("sourceControl");
    const codingAgent = ctx.providers.get("codingAgent");
    const issueData = getStepData(ctx, "create-issue");
    const issueIdentifier = issueData?.issueIdentifier ?? "";
    const issueBranchName = issueData?.issueBranchName;
    // -------------------------------------------------------------------------
    // 1. Check for existing PRs (duplicate check)
    // -------------------------------------------------------------------------
    const skipMergedCheck = !!config.issueOverride;
    let existingPr = await sourceControl.findExistingPr(issueIdentifier);
    if (existingPr && skipMergedCheck && existingPr.state !== "open") {
        existingPr = null;
    }
    if (existingPr) {
        if (config.issueOverride && existingPr.state !== "open") {
            ctx.logger.info(`Found ${existingPr.state} PR: ${existingPr.url} — issue override provided, implementing anyway`);
        }
        else {
            ctx.logger.info(`Found existing PR: ${existingPr.url} (state: ${existingPr.state}) — skipping`);
            return {
                status: "skipped",
                reason: `Existing PR found: ${existingPr.url}`,
                data: { existingPrUrl: existingPr.url },
            };
        }
    }
    // -------------------------------------------------------------------------
    // 2. Create branch and configure git
    // -------------------------------------------------------------------------
    await sourceControl.configureBotIdentity();
    let branchName;
    if (issueBranchName) {
        branchName = issueBranchName.replace(/^[^/]*\//, "");
    }
    else {
        branchName = `${issueIdentifier.toLowerCase()}-triage-fix`;
    }
    await sourceControl.createBranch(branchName);
    await sourceControl.resetPaths([".github/workflows/"]);
    ctx.logger.info(`Created branch: ${branchName}`);
    // -------------------------------------------------------------------------
    // 3. Install Claude and implement fix
    // -------------------------------------------------------------------------
    await codingAgent.install();
    const implementPrompt = buildImplementPrompt(issueIdentifier, analysisDir, config.issueTrackerName);
    await codingAgent.run({
        prompt: implementPrompt,
        maxTurns: config.maxImplementTurns,
        env: { ...config.agentEnv },
    });
    // -------------------------------------------------------------------------
    // 4. Check for code changes
    // -------------------------------------------------------------------------
    // Check if fix was declined
    const fixDeclinedPath = `${analysisDir}/fix-declined.md`;
    if (fs.existsSync(fixDeclinedPath)) {
        const reason = fs.readFileSync(fixDeclinedPath, "utf-8").trim();
        ctx.logger.info(`Fix was declined by Claude: ${reason.slice(0, 200)}`);
        return {
            status: "skipped",
            reason: `Fix declined: ${reason.slice(0, 200)}`,
        };
    }
    let hasCodeChanges = await sourceControl.hasNewCommits();
    if (!hasCodeChanges) {
        ctx.logger.info("No commits created by Claude");
        const hasUncommitted = await sourceControl.hasChanges();
        if (hasUncommitted) {
            ctx.logger.info("Found uncommitted code changes, creating fallback commit");
            await sourceControl.stageAndCommit(`fix: automated fix from log analysis\n\nPartial implementation by Claude (reached max turns before completion)\n\nIdentified by SWEny Triage\nLinear: ${issueIdentifier}`);
            hasCodeChanges = true;
        }
        else {
            ctx.logger.info("No code changes to commit");
            return {
                status: "skipped",
                reason: "No code changes produced",
            };
        }
    }
    else {
        const changedFiles = await sourceControl.getChangedFiles();
        ctx.logger.info(`Claude created commits with changes to: ${changedFiles.join(", ")}`);
    }
    // -------------------------------------------------------------------------
    // 5. Push branch
    // -------------------------------------------------------------------------
    await sourceControl.pushBranch(branchName);
    return {
        status: "success",
        data: { branchName, hasCodeChanges },
    };
}
//# sourceMappingURL=implement-fix.js.map