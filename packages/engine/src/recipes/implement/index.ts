import type { Recipe } from "../../types.js";
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
 *
 * Shared nodes (implement-fix, create-pr, notify) are typed to SharedNodeConfig,
 * which ImplementConfig satisfies — no type casts needed.
 */
export const implementRecipe: Recipe<ImplementConfig> = {
  name: "implement",
  description: "Implement a fix for a specific issue and open a pull request",
  start: "verify-access",
  nodes: [
    { id: "verify-access", phase: "learn", run: verifyAccess, critical: true },

    // Named "create-issue" so that implementFix and createPr find it via getStepData
    { id: "create-issue", phase: "learn", run: fetchIssue, critical: true },

    { id: "implement-fix", phase: "act", run: implementFix, on: { failed: "notify" } },
    { id: "create-pr", phase: "act", run: createPr, on: { failed: "notify" } },
    { id: "notify", phase: "report", run: sendNotification },
  ],
};

export type { ImplementConfig } from "./types.js";
