import { canListTriageHistory } from "@sweny/providers/issue-tracking";
/** Build known-issues context from issue tracker + source control to prevent duplicates. */
export async function buildContext(ctx) {
    const issueTracker = ctx.providers.get("issueTracker");
    const sourceControl = ctx.providers.get("sourceControl");
    const config = ctx.config;
    const lines = [];
    lines.push("# Known Triage History (Last 30 Days)");
    lines.push("");
    lines.push("These issues have already been identified by previous SWEny Triage runs.");
    lines.push("Do NOT create new issues or propose fixes for these same problems.");
    lines.push("");
    // 1. Fetch recent triage issues (last 30 days)
    lines.push("## Tracked Issues");
    try {
        if (canListTriageHistory(issueTracker)) {
            const triageHistory = await issueTracker.listTriageHistory(config.projectId, config.triageLabelId, 30);
            if (triageHistory.length > 0) {
                for (const entry of triageHistory) {
                    lines.push(`- **${entry.identifier}** [${entry.state}] ${entry.title} — ${entry.url}`);
                }
            }
            else {
                lines.push("_No triage-labeled issues found in last 30 days_");
            }
        }
        else {
            lines.push("_Issue tracker does not support triage history_");
        }
    }
    catch (err) {
        ctx.logger.warn(`Failed to fetch triage history: ${err}`);
        lines.push("_Failed to fetch triage history_");
    }
    lines.push("");
    // 2. Fetch recent triage PRs
    lines.push("## Pull Requests");
    try {
        const triagePrs = await sourceControl.listPullRequests({
            state: "all",
            labels: ["triage"],
            limit: 30,
        });
        lines.push("### Merged (fixed)");
        const merged = triagePrs.filter((pr) => pr.state === "merged");
        if (merged.length > 0) {
            for (const pr of merged) {
                lines.push(`- PR #${pr.number}: ${pr.title} — ${pr.url}`);
            }
        }
        else {
            lines.push("_None_");
        }
        lines.push("### Open (in progress)");
        const open = triagePrs.filter((pr) => pr.state === "open");
        if (open.length > 0) {
            for (const pr of open) {
                lines.push(`- PR #${pr.number}: ${pr.title} — ${pr.url}`);
            }
        }
        else {
            lines.push("_None_");
        }
        lines.push("### Closed (failed attempts)");
        const closed = triagePrs.filter((pr) => pr.state === "closed");
        if (closed.length > 0) {
            for (const pr of closed) {
                lines.push(`- PR #${pr.number}: ${pr.title} — ${pr.url}`);
            }
        }
        else {
            lines.push("_None_");
        }
    }
    catch {
        ctx.logger.warn("Failed to fetch triage PRs");
        lines.push("_Failed to fetch triage PRs_");
    }
    const knownIssuesContent = lines.join("\n");
    return {
        status: "success",
        data: { knownIssuesContent },
    };
}
//# sourceMappingURL=build-context.js.map