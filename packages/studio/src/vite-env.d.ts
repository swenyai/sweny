/// <reference types="vite/client" />

// Node-only executor entry, aliased in vite.config.ts to core's full
// `dist/index.js`. `execute` is intentionally absent from the browser entry
// (`@sweny-ai/core`), so the simulate panel lazy-imports it from here. Types
// mirror the package's main entry.
declare module "@sweny-ai/core-exec" {
  export { execute } from "@sweny-ai/core";
}
