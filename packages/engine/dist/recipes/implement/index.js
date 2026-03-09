import { verifyAccess } from "./steps/verify-access.js";
import { fetchIssue } from "./steps/fetch-issue.js";
import { implementFix } from "../../nodes/implement-fix.js";
import { createPr } from "../../nodes/create-pr.js";
import { sendNotification } from "../../nodes/notify.js";
import { createRecipe } from "../../runner-recipe.js";
/**
 * The implement recipe.
 *
 * Given a known issue identifier, fetches the issue, implements a fix,
 * and opens a PR. Skips the investigation/novelty phases of triage.
 *
 * Shared nodes (implement-fix, create-pr, notify) are typed to SharedNodeConfig,
 * which ImplementConfig satisfies — no type casts needed.
 */
export const implementRecipe = createRecipe({
    id: "implement",
    version: "1.0.0",
    name: "implement",
    description: "Implement a fix for a specific issue and open a pull request",
    initial: "verify-access",
    states: {
        "verify-access": { phase: "learn", critical: true, next: "create-issue" },
        // Named "create-issue" so that implementFix and createPr find it via getStepData
        "create-issue": { phase: "learn", critical: true, next: "implement-fix" },
        "implement-fix": { phase: "act", next: "create-pr", on: { failed: "notify" } },
        "create-pr": { phase: "act", next: "notify", on: { failed: "notify" } },
        "notify": { phase: "report" },
    },
}, {
    "verify-access": verifyAccess,
    // Named "create-issue" so that implementFix and createPr find it via getStepData
    "create-issue": fetchIssue,
    "implement-fix": implementFix,
    "create-pr": createPr,
    "notify": sendNotification,
});
//# sourceMappingURL=index.js.map