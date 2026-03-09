/**
 * The pure serializable definition of the implement recipe.
 * This file has NO implementation imports — safe for browser bundling.
 */
import type { RecipeDefinition } from "../../types.js";

export const implementDefinition: RecipeDefinition = {
  id: "implement",
  version: "1.0.0",
  name: "implement",
  description: "Implement a fix for a specific issue and open a pull request",
  initial: "verify-access",
  states: {
    "verify-access": { phase: "learn", critical: true, next: "create-issue" },
    // Named "create-issue" so that implementFix and createPr find it via getStepData
    "create-issue": { phase: "learn", critical: true, next: "implement-fix", description: "Fetch the issue details" },
    "implement-fix": { phase: "act", next: "create-pr", on: { failed: "notify" } },
    "create-pr": { phase: "act", next: "notify", on: { failed: "notify" } },
    notify: { phase: "report" },
  },
};
