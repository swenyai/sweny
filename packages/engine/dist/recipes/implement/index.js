import { implementDefinition } from "./definition.js";
import { verifyAccess } from "./steps/verify-access.js";
import { fetchIssue } from "./steps/fetch-issue.js";
import { implementFix } from "../../nodes/implement-fix.js";
import { createPr } from "../../nodes/create-pr.js";
import { sendNotification } from "../../nodes/notify.js";
import { createWorkflow } from "../../runner-recipe.js";
export { implementDefinition };
export const implementWorkflow = createWorkflow(implementDefinition, {
    "verify-access": verifyAccess,
    "create-issue": fetchIssue,
    "implement-fix": implementFix,
    "create-pr": createPr,
    notify: sendNotification,
});
//# sourceMappingURL=index.js.map