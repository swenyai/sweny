import { getStepData } from "../results.js";
/** Check investigation recommendation and decide whether to proceed with implementation. */
export async function noveltyGate(ctx) {
    const issueTracker = ctx.providers.get("issueTracker");
    const investigation = getStepData(ctx, "investigate");
    // Dry run — route to notify via DAG on
    if (ctx.config.dryRun) {
        ctx.logger.info("Dry run mode — skipping act phase");
        return {
            status: "success",
            data: { outcome: "skip", action: "dry-run", recommendation: investigation?.recommendation ?? "unknown" },
        };
    }
    if (!investigation) {
        return { status: "failed", reason: "No investigation result available" };
    }
    const recommendation = investigation.recommendation;
    // SKIP — no novel issues
    if (/skip/i.test(recommendation)) {
        ctx.logger.info("Recommendation is SKIP — no novel issues found");
        return {
            status: "success",
            data: { outcome: "skip", action: "skip", recommendation },
        };
    }
    // +1 EXISTING — add occurrence to existing issue
    if (/\+1 existing/i.test(recommendation)) {
        ctx.logger.info(`Recommendation is +1 EXISTING — adding occurrence to ${investigation.existingIssue}`);
        if (investigation.existingIssue) {
            try {
                const existing = await issueTracker.getIssue(investigation.existingIssue);
                const date = new Date().toISOString().split("T")[0];
                await issueTracker.addComment(existing.id, `+1 detected on ${date}`);
                ctx.logger.info(`Added +1 occurrence to ${investigation.existingIssue}`);
            }
            catch (err) {
                ctx.logger.warn(`Failed to add occurrence: ${err}`);
            }
        }
        return {
            status: "success",
            data: {
                outcome: "skip",
                action: "+1",
                recommendation,
                issueIdentifier: investigation.existingIssue,
            },
        };
    }
    // IMPLEMENT — proceed with fix
    ctx.logger.info("Recommendation is IMPLEMENT — proceeding with fix");
    return {
        status: "success",
        data: { outcome: "implement", action: "implement", recommendation },
    };
}
//# sourceMappingURL=novelty-gate.js.map