import * as fs from "node:fs";
/** Fetch issue details from the tracker and write a context file for the coding agent. */
export async function fetchIssue(ctx) {
    const issueTracker = ctx.providers.get("issueTracker");
    const issue = await issueTracker.getIssue(ctx.config.issueIdentifier);
    ctx.logger.info(`Fetched issue: ${issue.identifier} — ${issue.title}`);
    const analysisDir = ctx.config.analysisDir ?? ".github/triage-analysis";
    fs.mkdirSync(analysisDir, { recursive: true });
    fs.writeFileSync(`${analysisDir}/best-candidate.md`, [
        `# ${issue.title}`,
        ``,
        `**Issue**: ${issue.identifier}`,
        `**URL**: ${issue.url}`,
        ``,
        `## Description`,
        ``,
        issue.description ?? "(no description provided)",
    ].join("\n"));
    return {
        status: "success",
        data: {
            issueId: issue.id,
            issueIdentifier: issue.identifier,
            issueTitle: issue.title,
            issueUrl: issue.url,
            issueBranchName: issue.branchName,
        },
    };
}
//# sourceMappingURL=fetch-issue.js.map