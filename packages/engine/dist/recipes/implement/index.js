import { verifyAccess } from "./steps/verify-access.js";
import { fetchIssue } from "./steps/fetch-issue.js";
import { implementFix } from "../triage/steps/implement-fix.js";
import { createPr } from "../triage/steps/create-pr.js";
import { sendNotification } from "../triage/steps/notify.js";
/**
 * The implement recipe.
 *
 * Given a known issue identifier, fetches the issue, implements a fix,
 * and opens a PR. Skips the investigation/novelty phases of triage.
 *
 * Steps that were written for TriageConfig are reused via cast — they only
 * access the config fields that ImplementConfig also provides.
 */
export const implementWorkflow = {
    name: "implement",
    description: "Implement a fix for a specific issue and open a pull request",
    steps: [
        { name: "verify-access", phase: "learn", run: verifyAccess },
        // Named "create-issue" so that implementFix and createPr find it via getStepData
        { name: "create-issue", phase: "learn", run: fetchIssue },
        // Cast: implementFix/createPr use TriageConfig but only access fields
        // that ImplementConfig provides (agentEnv, dryRun, maxImplementTurns, etc.)
        {
            name: "implement-fix",
            phase: "act",
            run: implementFix,
        },
        {
            name: "create-pr",
            phase: "act",
            run: createPr,
        },
        {
            name: "notify",
            phase: "report",
            run: sendNotification,
        },
    ],
};
//# sourceMappingURL=index.js.map