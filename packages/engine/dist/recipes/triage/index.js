import { triageDefinition } from "./definition.js";
import { dedupCheck } from "./steps/dedup-check.js";
import { verifyAccess } from "./steps/verify-access.js";
import { buildContext } from "./steps/build-context.js";
import { investigate } from "./steps/investigate.js";
import { noveltyGate } from "./steps/novelty-gate.js";
import { createIssue } from "./steps/create-issue.js";
import { crossRepoCheck } from "./steps/cross-repo-check.js";
import { implementFix } from "../../nodes/implement-fix.js";
import { createPr } from "../../nodes/create-pr.js";
import { sendNotification } from "../../nodes/notify.js";
import { createWorkflow } from "../../runner-recipe.js";
export { triageDefinition };
export const triageWorkflow = createWorkflow(triageDefinition, {
    "dedup-check": dedupCheck,
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