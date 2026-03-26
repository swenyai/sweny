import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@sweny-ai/core/workflows": resolve(__dirname, "../core/dist/workflows/index.js"),
      "@sweny-ai/core/studio": resolve(__dirname, "../core/dist/studio.js"),
      "@sweny-ai/core/schema": resolve(__dirname, "../core/dist/schema.js"),
      "@sweny-ai/core/testing": resolve(__dirname, "../core/dist/testing.js"),
      "@sweny-ai/core": resolve(__dirname, "../core/dist/browser.js"),
    },
  },
});
