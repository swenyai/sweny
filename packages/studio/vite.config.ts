import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { aiMiddlewarePlugin } from "./src/server/ai-middleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isLib = process.env.BUILD_MODE === "lib";

export default defineConfig({
  plugins: [react(), aiMiddlewarePlugin()],
  resolve: {
    // Array form so the elkjs entry can be an exact-match regex. An object-map
    // string key is a prefix alias: Rolldown rewrites the matched "elkjs"
    // prefix inside "elkjs/lib/elk.bundled.js" and re-appends the subpath,
    // double-resolving to ".../elk.bundled.js/lib/elk.bundled.js" and failing
    // the SPA build. Exact-match regexes avoid the prefix swallow.
    alias: [
      // In the browser, redirect "elkjs" to the bundled (no-worker) version.
      // Match both the bare specifier and the explicit bundled subpath import.
      {
        find: /^elkjs(\/lib\/elk\.bundled\.js)?$/,
        replacement: resolve(__dirname, "../../node_modules/elkjs/lib/elk.bundled.js"),
      },
      // Redirect @sweny-ai/core subpath imports to the built dist
      {
        find: "@sweny-ai/core/studio",
        replacement: resolve(__dirname, "../../packages/core/dist/studio.js"),
      },
      {
        find: "@sweny-ai/core/schema",
        replacement: resolve(__dirname, "../../packages/core/dist/schema.js"),
      },
      {
        find: "@sweny-ai/core/workflows",
        replacement: resolve(__dirname, "../../packages/core/dist/workflows/browser.js"),
      },
      {
        find: "@sweny-ai/core/testing",
        replacement: resolve(__dirname, "../../packages/core/dist/testing.js"),
      },
      // Node-only executor entry. `execute` is intentionally NOT re-exported
      // from the browser entry (it pulls `node:fs` via source-resolver), so the
      // simulate panel lazy-imports it from this dedicated specifier — keeping
      // it out of the eager browser graph (an async chunk) while still letting
      // the build resolve the export.
      {
        find: "@sweny-ai/core-exec",
        replacement: resolve(__dirname, "../../packages/core/dist/index.js"),
      },
      {
        find: /^@sweny-ai\/core$/,
        replacement: resolve(__dirname, "../../packages/core/dist/browser.js"),
      },
    ],
  },
  ...(isLib
    ? {
        // Library build
        build: {
          lib: {
            entry: {
              viewer: resolve(__dirname, "src/lib-viewer.ts"),
              editor: resolve(__dirname, "src/lib-editor.ts"),
            },
            formats: ["es"],
            // Vite 6+ derives css filename from package name ("studio.css")
            // by default; pin to "style" so the published exports map
            // (./style.css → ./dist/lib/style.css) keeps working.
            cssFileName: "style",
          },
          rollupOptions: {
            // Don't bundle peer dependencies — consumer provides them
            external: [
              "react",
              "react-dom",
              "react/jsx-runtime",
              "@xyflow/react",
              "elkjs",
              "elkjs/lib/elk.bundled.js",
              "@sweny-ai/core",
              "@sweny-ai/core/studio",
              "@sweny-ai/core/schema",
              "@sweny-ai/core/workflows",
              "@sweny-ai/core/testing",
            ],
            output: {
              assetFileNames: "[name][extname]",
              chunkFileNames: "chunks/[name]-[hash].js",
              entryFileNames: "[name].js",
            },
          },
          outDir: "dist/lib",
          emptyOutDir: true,
        },
      }
    : {
        // App build (existing)
        build: {
          rollupOptions: {
            output: {
              // Function form: Vite 8 / Rolldown ignores the object-map form
              // ("Invalid type: Expected Function but received Object") and
              // silently drops vendor code-splitting.
              manualChunks(id) {
                if (id.includes("elkjs")) return "elk";
                if (id.includes("@xyflow/react")) return "xyflow";
                if (/node_modules\/(react|react-dom)\//.test(id)) return "react";
                if (/node_modules\/(zustand|immer|zundo)\//.test(id)) return "zustand";
              },
            },
          },
        },
      }),
});
