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
      // Redirect @sweny-ai/engine to its browser-safe entry point,
      // which exports only pure serializable data (no Node.js implementations).
      "@sweny-ai/engine": resolve(__dirname, "../../packages/engine/dist/browser.js"),
    },
  },
});
