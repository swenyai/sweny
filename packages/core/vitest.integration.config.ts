import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/integration/**/*.integration.test.ts"],
    testTimeout: 30_000,
  },
});
