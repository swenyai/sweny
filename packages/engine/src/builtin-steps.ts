/**
 * Central registration of all built-in step types.
 * Import this module to populate builtinStepRegistry before calling resolveWorkflow().
 */
import { registerStepType } from "./step-registry.js";

// Triage steps
import { verifyAccess as triageVerifyAccess } from "./recipes/triage/steps/verify-access.js";
import { buildContext } from "./recipes/triage/steps/build-context.js";
import { investigate } from "./recipes/triage/steps/investigate.js";
import { noveltyGate } from "./recipes/triage/steps/novelty-gate.js";
import { createIssue } from "./recipes/triage/steps/create-issue.js";
import { crossRepoCheck } from "./recipes/triage/steps/cross-repo-check.js";
import { dedupCheck } from "./recipes/triage/steps/dedup-check.js";

// Implement steps
import { verifyAccess as implementVerifyAccess } from "./recipes/implement/steps/verify-access.js";
import { fetchIssue } from "./recipes/implement/steps/fetch-issue.js";

// Shared nodes
import { createPr } from "./nodes/create-pr.js";
import { implementFix } from "./nodes/implement-fix.js";
import { sendNotification } from "./nodes/notify.js";

registerStepType({
  type: "sweny/verify-access",
  description: "Verify that configured providers are reachable (triage: observability + issue tracker)",
  impl: triageVerifyAccess,
});

registerStepType({
  type: "sweny/verify-access-implement",
  description: "Verify that configured providers are reachable (implement: issue tracker + source control)",
  impl: implementVerifyAccess,
});

registerStepType({
  type: "sweny/build-context",
  description: "Fetch recent logs and build context for investigation",
  impl: buildContext,
});

registerStepType({
  type: "sweny/investigate",
  description: "Run the coding agent to investigate and triage the incident",
  impl: investigate,
});

registerStepType({
  type: "sweny/novelty-gate",
  description: "Check if the issue is novel or a duplicate",
  impl: noveltyGate,
});

registerStepType({
  type: "sweny/create-issue",
  description: "Create a new issue in the issue tracker",
  impl: createIssue,
});

registerStepType({
  type: "sweny/cross-repo-check",
  description: "Check for related issues across repositories",
  impl: crossRepoCheck,
});

registerStepType({
  type: "sweny/dedup-check",
  description: "Check if this event has already been processed (idempotency)",
  impl: dedupCheck,
});

registerStepType({
  type: "sweny/fetch-issue",
  description: "Fetch issue details from the issue tracker and write a context file",
  impl: fetchIssue,
});

registerStepType({
  type: "sweny/implement-fix",
  description: "Run the coding agent to implement a fix",
  impl: implementFix,
});

registerStepType({
  type: "sweny/create-pr",
  description: "Create a pull request with the implemented changes",
  impl: createPr,
});

registerStepType({
  type: "sweny/notify",
  description: "Send notification about the workflow outcome",
  impl: sendNotification,
});
