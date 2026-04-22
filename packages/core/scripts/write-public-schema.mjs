#!/usr/bin/env node
/**
 * Generate spec/public/schemas/workflow.json from the canonical
 * workflowJsonSchema in @sweny-ai/core.
 *
 * Fix #4: before this existed the published schema was hand-maintained and
 * drifted against the runtime (missing verify/requires/retry entirely).
 * This script makes the published file a build artifact of the TS source.
 *
 * Called from `npm run build --workspace=packages/core`. Writes to the
 * repo-root spec/ directory so the spec.sweny.ai Astro build can pick it
 * up without additional wiring.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");

const { workflowJsonSchema } = await import("../dist/schema.js");
if (!workflowJsonSchema) {
  console.error("write-public-schema: workflowJsonSchema not exported from dist/schema.js");
  process.exit(1);
}

const target = resolve(repoRoot, "spec", "public", "schemas", "workflow.json");
mkdirSync(dirname(target), { recursive: true });
const next = JSON.stringify(workflowJsonSchema, null, 2) + "\n";

let current = "";
try {
  current = readFileSync(target, "utf-8");
} catch {
  // first write is fine
}

if (current === next) {
  // Don't touch mtime if the content is identical — keeps git diffs clean.
  console.log(`write-public-schema: ${target} already up to date`);
  process.exit(0);
}

writeFileSync(target, next, "utf-8");
console.log(`write-public-schema: wrote ${target} (${next.length} bytes)`);
