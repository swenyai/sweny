import { verifyAccess } from "./steps/verify-access.js";
import { buildContext } from "./steps/build-context.js";
import { investigate } from "./steps/investigate.js";
import { noveltyGate } from "./steps/novelty-gate.js";
import { createIssue } from "./steps/create-issue.js";
import { crossRepoCheck } from "./steps/cross-repo-check.js";
import { implementFix } from "./steps/implement-fix.js";
import { createPr } from "./steps/create-pr.js";
import { sendNotification } from "./steps/notify.js";
import { createRecipe } from "../../runner-recipe.js";
// Re-export the pure serializable definition (browser-safe)
export { triageDefinition } from "./definition.js";
/** The triage recipe — DAG with explicit on transitions. */
export const triageRecipe = createRecipe({
    id: "triage",
    version: "1.0.0",
    name: "triage",
    description: "Investigate production issues, implement fixes, and report results",
    initial: "verify-access",
    states: {
        // Learn phase — gather data
        "verify-access": { phase: "learn", critical: true, next: "build-context" },
        "build-context": { phase: "learn", critical: true, next: "investigate" },
        investigate: { phase: "learn", critical: true, next: "novelty-gate" },
        // Act phase — novelty gate routes to create-issue or directly to notify
        "novelty-gate": {
            phase: "act",
            on: {
                skip: "notify", // dry-run, skip, or +1 all go straight to report
                implement: "create-issue",
                failed: "notify",
            },
        },
        "create-issue": { phase: "act", next: "cross-repo-check", on: { failed: "notify" } },
        // Cross-repo check routes to implement-fix or to notify (failed also goes to notify)
        "cross-repo-check": {
            phase: "act",
            on: {
                local: "implement-fix",
                dispatched: "notify",
                failed: "notify",
            },
        },
        "implement-fix": { phase: "act", next: "create-pr", on: { failed: "notify" } },
        "create-pr": { phase: "act", next: "notify", on: { failed: "notify" } },
        // Report phase — notify stakeholders
        notify: { phase: "report" },
    },
}, {
    "verify-access": verifyAccess,
    "build-context": buildContext,
    investigate: investigate,
    "novelty-gate": noveltyGate,
    "create-issue": createIssue,
    "cross-repo-check": crossRepoCheck,
    "implement-fix": implementFix,
    "create-pr": createPr,
    notify: sendNotification,
});
export { getStepData } from "./results.js";
//# sourceMappingURL=index.js.map