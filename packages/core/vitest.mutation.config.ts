import { defineConfig } from "vitest/config";

// Only the specs that exercise the mutated modules (see stryker.config.json).
// Keeps each mutant's test run short; broad coverage stays with `npm test`.
export default defineConfig({
  test: {
    include: [
      "src/__tests__/mutation/*.test.ts",
      "src/__tests__/when.test.ts",
      "src/__tests__/when-routing.test.ts",
      "src/safe-outputs.test.ts",
      "src/__tests__/safe-outputs-executor.test.ts",
      "src/__tests__/budget.test.ts",
      "src/journal.test.ts",
      "src/__tests__/run-journal.test.ts",
      "src/cli/resume.test.ts",
      "src/__tests__/agent-env.test.ts",
      "src/__tests__/agent-env-noise.test.ts",
      "src/__tests__/agent-credentials.test.ts",
      "src/__tests__/stage-no-push.test.ts",
      "src/__tests__/eval-policy.test.ts",
      "src/__tests__/workflow-yaml.test.ts",
      "src/harness/policy.test.ts",
    ],
  },
});
