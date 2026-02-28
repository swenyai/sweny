import { verifyAccess } from "./steps/verify-access.js";
import { buildContext } from "./steps/build-context.js";
import { investigate } from "./steps/investigate.js";
import { noveltyGate } from "./steps/novelty-gate.js";
import { createIssue } from "./steps/create-issue.js";
import { crossRepoCheck } from "./steps/cross-repo-check.js";
import { implementFix } from "./steps/implement-fix.js";
import { createPr } from "./steps/create-pr.js";
import { sendNotification } from "./steps/notify.js";
/** The triage recipe — first workflow on the SWEny platform. */
export const triageWorkflow = {
    name: "triage",
    description: "Investigate production issues, implement fixes, and report results",
    steps: [
        // Learn phase — gather data
        { name: "verify-access", phase: "learn", run: verifyAccess },
        { name: "build-context", phase: "learn", run: buildContext },
        { name: "investigate", phase: "learn", run: investigate },
        // Act phase — fix the problem
        { name: "novelty-gate", phase: "act", run: noveltyGate },
        { name: "create-issue", phase: "act", run: createIssue },
        { name: "cross-repo-check", phase: "act", run: crossRepoCheck },
        { name: "implement-fix", phase: "act", run: implementFix },
        { name: "create-pr", phase: "act", run: createPr },
        // Report phase — notify stakeholders
        { name: "notify", phase: "report", run: sendNotification },
    ],
};
//# sourceMappingURL=index.js.map