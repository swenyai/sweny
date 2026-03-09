import type { TriageConfig } from "./types.js";
import { triageDefinition } from "./definition.js";
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

export { triageDefinition };

export const triageRecipe = createRecipe<TriageConfig>(triageDefinition, {
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

export type {
  TriageConfig,
  InvestigationResult,
  ImplementResult,
  BuildContextData,
  IssueData,
  ImplementFixData,
  PrData,
  CrossRepoData,
  TriageStepDataMap,
} from "./types.js";
export { getStepData } from "./results.js";
