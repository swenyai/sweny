#!/usr/bin/env node
/**
 * Generate spec/public/schemas/{workflow,skill}.json from the canonical
 * JSON Schema constants in @sweny-ai/core.
 *
 * Fix #4 introduced the workflow generator: before that, the published
 * schema was hand-maintained and drifted against the runtime (missing
 * verify/requires/retry entirely). The skill schema was added later
 * for the same reason: the `data` category landed in runtime types but
 * the hand-maintained schema didn't get updated, so external tooling
 * silently rejected valid skills.
 *
 * Called from `npm run build --workspace=packages/core`. Writes to the
 * repo-root spec/ directory so the spec.sweny.ai Astro build picks it
 * up without additional wiring.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const require = createRequire(import.meta.url);

const { workflowJsonSchema, skillJsonSchema } = await import("../dist/schema.js");
if (!workflowJsonSchema || !skillJsonSchema) {
  console.error(
    "write-public-schema: workflowJsonSchema and skillJsonSchema must both be exported from dist/schema.js",
  );
  process.exit(1);
}

const prettier = require("prettier");

async function writeSchema(name, schema) {
  const target = resolve(repoRoot, "spec", "public", "schemas", `${name}.json`);
  mkdirSync(dirname(target), { recursive: true });

  // Format through prettier so the generated file matches the repo's
  // formatting conventions exactly. Otherwise the lint-staged hook would
  // reformat on commit and the CI schema-drift check would fail on every
  // build.
  const prettierConfig = (await prettier.resolveConfig(target)) ?? {};
  const raw = JSON.stringify(schema, null, 2);
  const next = await prettier.format(raw, { ...prettierConfig, filepath: target, parser: "json" });

  let current = "";
  try {
    current = readFileSync(target, "utf-8");
  } catch {
    // first write is fine
  }

  if (current === next) {
    // Don't touch mtime if the content is identical (keeps git diffs clean).
    console.log(`write-public-schema: ${target} already up to date`);
    return;
  }

  writeFileSync(target, next, "utf-8");
  console.log(`write-public-schema: wrote ${target} (${next.length} bytes)`);
}

await writeSchema("workflow", workflowJsonSchema);
await writeSchema("skill", skillJsonSchema);
