import type { Workflow } from "../../types.js";
import type { ImplementConfig } from "./types.js";
import { verifyAccess } from "./steps/verify-access.js";
import { fetchIssue } from "./steps/fetch-issue.js";
import { implementFix } from "../../nodes/implement-fix.js";
import { createPr } from "../../nodes/create-pr.js";
import { sendNotification } from "../../nodes/notify.js";

/**
 * The implement recipe.
 *
 * Given a known issue identifier, fetches the issue, implements a fix,
 * and opens a PR. Skips the investigation/novelty phases of triage.
 */
export const implementWorkflow: Workflow<ImplementConfig> = {
  name: "implement",
  description: "Implement a fix for a specific issue and open a pull request",
  steps: [
    { name: "verify-access", phase: "learn", run: verifyAccess },

    // Named "create-issue" so that implementFix and createPr find it via getStepData
    { name: "create-issue", phase: "learn", run: fetchIssue },

    { name: "implement-fix", phase: "act", run: implementFix },
    { name: "create-pr", phase: "act", run: createPr },
    { name: "notify", phase: "report", run: sendNotification },
  ],
};

export type { ImplementConfig } from "./types.js";
