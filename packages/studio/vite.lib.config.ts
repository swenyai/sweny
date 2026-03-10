import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Library build configuration.
 * Produces two entry points:
 *   dist/lib/viewer.js  — read-only RecipeViewer component (minimal surface)
 *   dist/lib/editor.js  — full editor store + StandaloneViewer (for dashboards)
 *
 * React, react-dom, and @sweny-ai/engine are externals (peer dependencies).
 * @xyflow/react, elkjs, zustand, immer, and zundo are bundled.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      elkjs: resolve(__dirname, "../../node_modules/elkjs/lib/elk.bundled.js"),
      "@sweny-ai/engine": resolve(__dirname, "../../packages/engine/dist/browser.js"),
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
      external: ["react", "react-dom", "react/jsx-runtime", "@sweny-ai/engine"],
      output: {
        // Preserve CSS in a single file for consumers to import
        assetFileNames: "style.css",
      },
    },
  },
});
