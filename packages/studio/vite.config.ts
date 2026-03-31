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
    alias: {
      // In the browser, redirect "elkjs" to the bundled (no-worker) version
      elkjs: resolve(__dirname, "../../node_modules/elkjs/lib/elk.bundled.js"),
      // Redirect @sweny-ai/core subpath imports to the built dist
      "@sweny-ai/core/studio": resolve(__dirname, "../../packages/core/dist/studio.js"),
      "@sweny-ai/core/schema": resolve(__dirname, "../../packages/core/dist/schema.js"),
      "@sweny-ai/core/workflows": resolve(__dirname, "../../packages/core/dist/workflows/browser.js"),
      "@sweny-ai/core/testing": resolve(__dirname, "../../packages/core/dist/testing.js"),
      "@sweny-ai/core": resolve(__dirname, "../../packages/core/dist/browser.js"),
    },
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
          },
          rollupOptions: {
            // Don't bundle peer dependencies — consumer provides them
            external: [
              "react",
              "react-dom",
              "react/jsx-runtime",
              "@xyflow/react",
              "elkjs",
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
              manualChunks: {
                react: ["react", "react-dom"],
                xyflow: ["@xyflow/react"],
                elk: ["elkjs"],
                zustand: ["zustand", "immer", "zundo"],
              },
            },
          },
        },
      }),
});
