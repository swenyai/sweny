import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Library build configuration.
 * Produces two entry points:
 *   dist-lib/viewer.js  — read-only WorkflowViewer component
 *   dist-lib/editor.js  — full editor store + StandaloneViewer
 *
 * React, react-dom, and @sweny-ai/core are externals (peer dependencies).
 * @xyflow/react, elkjs, zustand, immer, and zundo are bundled.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      elkjs: resolve(__dirname, "../../node_modules/elkjs/lib/elk.bundled.js"),
      "@sweny-ai/core/studio": resolve(__dirname, "../../packages/core/dist/studio.js"),
      "@sweny-ai/core/schema": resolve(__dirname, "../../packages/core/dist/schema.js"),
      "@sweny-ai/core/workflows": resolve(__dirname, "../../packages/core/dist/workflows/index.js"),
      "@sweny-ai/core/testing": resolve(__dirname, "../../packages/core/dist/testing.js"),
      "@sweny-ai/core": resolve(__dirname, "../../packages/core/dist/browser.js"),
    },
  },
  build: {
    outDir: "dist-lib",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: {
        viewer: resolve(__dirname, "src/lib-viewer.ts"),
        editor: resolve(__dirname, "src/lib-editor.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "@sweny-ai/core",
        "@sweny-ai/core/studio",
        "@sweny-ai/core/schema",
        "@sweny-ai/core/workflows",
        "@sweny-ai/core/testing",
      ],
      output: {
        assetFileNames: "style.css",
      },
    },
  },
});
