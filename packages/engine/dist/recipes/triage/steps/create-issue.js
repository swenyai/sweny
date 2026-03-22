import * as fs from "node:fs";
import { canSearchByFingerprint } from "@sweny-ai/providers/issue-tracking";
import { fingerprintEvent } from "../../../lib/fingerprint.js";
const TITLE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 10000;
/**
 * Normalise an issue title into a stable error_pattern string.
 * Strips common fix-prefix words and collapses whitespace so that
 * "Fix null pointer in auth" and "Resolve null pointer in auth" hash identically.
 */
function normalizeErrorPattern(title) {
    return title
        .toLowerCase()
        .replace(/^(fix|resolve|handle|add|update|improve)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
}
/** Resolve the service identifier from the service filter (collapses wildcards to "unknown"). */
function resolveService(serviceFilter) {
    return serviceFilter && serviceFilter !== "*" ? serviceFilter : "unknown";
}
/**
 * Appends a TRIAGE_FINGERPRINT HTML comment block to the issue description.
 * The hash is derived from the normalized error pattern and service filter so
 * it's stable across runs for the same underlying error.
 *
 * The block format matches ENG-648 and is used by `searchByFingerprint` in
 * the Linear provider to do hard dedup beyond title-matching.
 */
function appendFingerprintBlock(description, issueTitle, serviceFilter) {
    const date = new Date().toISOString().split("T")[0];
    const errorPattern = normalizeErrorPattern(issueTitle);
    const service = resolveService(serviceFilter);
    const hash = fingerprintEvent({ error_pattern: errorPattern, service });
    const block = [
        "",
        "<!-- TRIAGE_FINGERPRINT",
        `error_pattern: ${errorPattern}`,
        `service: ${service}`,
        `fingerprint: ${hash}`,
        `date: ${date}`,
        "-->",
    ].join("\n");
    return description + block;
}
/** Extract issue title from best-candidate.md, then get-or-create an issue in the tracker. */
export async function createIssue(ctx) {
    const config = ctx.config;
    const analysisDir = config.analysisDir ?? ".github/triage-analysis";
    const issueTracker = ctx.providers.get("issueTracker");
    // -------------------------------------------------------------------------
    // 1. Extract issue title from best-candidate.md
    // -------------------------------------------------------------------------
    let issueTitle = "SWEny Triage: Automated bug fix";
    if (!config.issueOverride) {
        const bestCandidatePath = `${analysisDir}/best-candidate.md`;
        if (fs.existsSync(bestCandidatePath)) {
            const content = fs.readFileSync(bestCandidatePath, "utf-8");
            const headingMatch = content.match(/^#\s+(.+)$/m);
            if (headingMatch) {
                issueTitle = headingMatch[1]
                    .replace(/`/g, "")
                    .replace(/^(Best\s+)?(Fix\s+)?(Candidate)(\s+Fix)?[:\s]*/i, "")
                    .trim()
                    .slice(0, TITLE_MAX_LENGTH);
            }
            if (!issueTitle) {
                issueTitle = "SWEny Triage: Automated bug fix";
            }
        }
        ctx.logger.info(`Extracted title: ${issueTitle}`);
    }
    // -------------------------------------------------------------------------
    // 2. Get or create issue
    // -------------------------------------------------------------------------
    let issue;
    if (config.issueOverride) {
        // User provided a specific issue
        ctx.logger.info(`User provided issue: ${config.issueOverride}`);
        issue = await issueTracker.getIssue(config.issueOverride);
        ctx.logger.info(`Working on issue: ${issue.identifier} - ${issue.url}`);
    }
    else {
        const date = new Date().toISOString().split("T")[0];
        // ── Hard dedup: fingerprint hash search ──────────────────────────────────
        // Compute the same hash that will be embedded in the issue description.
        // If the provider finds an existing issue with this fingerprint, it's a
        // definitive duplicate regardless of how the LLM may have reworded the title.
        const fingerprintHash = fingerprintEvent({
            error_pattern: normalizeErrorPattern(issueTitle),
            service: resolveService(config.serviceFilter),
        });
        if (canSearchByFingerprint(issueTracker)) {
            ctx.logger.info(`Hard dedup: searching for fingerprint ${fingerprintHash}`);
            const fingerprintMatches = await issueTracker.searchByFingerprint(config.projectId, fingerprintHash);
            if (fingerprintMatches.length > 0) {
                issue = fingerprintMatches[0];
                await issueTracker.addComment(issue.id, `+1 detected on ${date} (fingerprint match: ${fingerprintHash})`);
                ctx.logger.info(`Fingerprint match — +1 on ${issue.identifier}`);
                return {
                    status: "success",
                    data: {
                        issueId: issue.id,
                        issueIdentifier: issue.identifier,
                        issueTitle: issue.title || issueTitle,
                        issueUrl: issue.url,
                        issueBranchName: issue.branchName,
                    },
                };
            }
        }
        // ── Soft dedup: title substring search ───────────────────────────────────
        ctx.logger.info(`Soft dedup: searching for existing issues matching: ${issueTitle}`);
        const searchResults = await issueTracker.searchIssues({
            projectId: config.projectId,
            query: issueTitle,
            labels: [config.bugLabelId],
        });
        if (searchResults.length > 0) {
            issue = searchResults[0];
            await issueTracker.addComment(issue.id, `+1 detected on ${date}`);
            ctx.logger.info(`Title match — +1 on ${issue.identifier}`);
        }
        else {
            ctx.logger.info("No existing issue found, creating new one...");
            let description = "";
            const bestCandidatePath = `${analysisDir}/best-candidate.md`;
            if (fs.existsSync(bestCandidatePath)) {
                description = fs.readFileSync(bestCandidatePath, "utf-8").slice(0, DESCRIPTION_MAX_LENGTH);
            }
            description = appendFingerprintBlock(description, issueTitle, config.serviceFilter);
            const labelIds = [config.bugLabelId, config.triageLabelId, ...(config.issueLabels ?? [])].filter((l) => !!l);
            issue = await issueTracker.createIssue({
                title: issueTitle,
                projectId: config.projectId,
                labels: labelIds,
                priority: config.issuePriority ?? 2,
                stateId: config.stateBacklog,
                description,
            });
            ctx.logger.info(`Created new issue: ${issue.identifier} - ${issue.url}`);
        }
    }
    return {
        status: "success",
        data: {
            issueId: issue.id,
            issueIdentifier: issue.identifier,
            issueTitle: issue.title || issueTitle,
            issueUrl: issue.url,
            issueBranchName: issue.branchName,
        },
    };
}
//# sourceMappingURL=create-issue.js.map