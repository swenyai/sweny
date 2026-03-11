/**
 * The pure serializable definition of the triage recipe.
 * This file has NO implementation imports — safe for browser bundling.
 */
import type { RecipeDefinition } from "../../types.js";

export const triageDefinition: RecipeDefinition = {
  id: "triage",
  version: "1.0.0",
  name: "triage",
  description: "Investigate production issues, implement fixes, and report results",
  initial: "dedup-check",
  states: {
    // Pre-flight — deterministic dedup before any provider/LLM calls
    "dedup-check": { phase: "learn", next: "verify-access", on: { notify: "notify" } },

    // Learn phase — gather data
    "verify-access": { phase: "learn", critical: true, next: "build-context" },
    "build-context": { phase: "learn", critical: true, next: "investigate" },
    investigate: { phase: "learn", critical: true, next: "novelty-gate" },

    // Act phase — novelty gate routes to create-issue or directly to notify
    "novelty-gate": {
      phase: "act",
      on: {
        skip: "notify",
        implement: "create-issue",
        failed: "notify",
      },
    },
    "create-issue": { phase: "act", next: "cross-repo-check", on: { failed: "notify" } },

    // Cross-repo check routes to implement-fix or to notify
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
};
