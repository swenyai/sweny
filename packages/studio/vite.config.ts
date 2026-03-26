import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["elkjs/lib/elk.bundled.js"],
  },
  resolve: {
    alias: {
      // In the browser, redirect "elkjs" to the bundled (no-worker) version
      elkjs: resolve(__dirname, "../../node_modules/elkjs/lib/elk.bundled.js"),
      // Redirect @sweny-ai/core subpath imports to the built dist
      "@sweny-ai/core/studio": resolve(__dirname, "../../packages/core/dist/studio.js"),
      "@sweny-ai/core/schema": resolve(__dirname, "../../packages/core/dist/schema.js"),
      "@sweny-ai/core/workflows": resolve(__dirname, "../../packages/core/dist/workflows/index.js"),
      "@sweny-ai/core/testing": resolve(__dirname, "../../packages/core/dist/testing.js"),
      "@sweny-ai/core": resolve(__dirname, "../../packages/core/dist/browser.js"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          xyflow: ["@xyflow/react"],
          elk: ["elkjs"],
          zustand: ["zustand", "immer", "zundo"],
        },
      },
    },
  },
});
