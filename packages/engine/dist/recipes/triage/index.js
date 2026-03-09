import { verifyAccess } from "./steps/verify-access.js";
import { buildContext } from "./steps/build-context.js";
import { investigate } from "./steps/investigate.js";
import { noveltyGate } from "./steps/novelty-gate.js";
import { createIssue } from "./steps/create-issue.js";
import { crossRepoCheck } from "./steps/cross-repo-check.js";
import { implementFix } from "./steps/implement-fix.js";
import { createPr } from "./steps/create-pr.js";
import { sendNotification } from "./steps/notify.js";
/** The triage recipe — DAG with explicit on transitions. */
export const triageRecipe = {
    name: "triage",
    description: "Investigate production issues, implement fixes, and report results",
    start: "verify-access",
    nodes: [
        // Learn phase — gather data
        { id: "verify-access", phase: "learn", run: verifyAccess, critical: true },
        { id: "build-context", phase: "learn", run: buildContext, critical: true },
        { id: "investigate", phase: "learn", run: investigate, critical: true },
        // Act phase — novelty gate routes to create-issue or directly to notify
        {
            id: "novelty-gate",
            phase: "act",
            run: noveltyGate,
            on: {
                skip: "notify", // dry-run, skip, or +1 all go straight to report
                implement: "create-issue",
                failed: "notify",
            },
        },
        { id: "create-issue", phase: "act", run: createIssue, on: { failed: "notify" } },
        // Cross-repo check routes to implement-fix or to notify (failed also goes to notify)
        {
            id: "cross-repo-check",
            phase: "act",
            run: crossRepoCheck,
            on: {
                local: "implement-fix",
                dispatched: "notify",
                failed: "notify",
            },
        },
        { id: "implement-fix", phase: "act", run: implementFix, on: { failed: "notify" } },
        { id: "create-pr", phase: "act", run: createPr, on: { failed: "notify" } },
        // Report phase — notify stakeholders
        { id: "notify", phase: "report", run: sendNotification },
    ],
};
export { getStepData } from "./results.js";
//# sourceMappingURL=index.js.map