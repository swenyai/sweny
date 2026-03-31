/**
 * Generate a browser-safe JS module that exports built-in workflows
 * as static objects (parsed from YAML at build time, not runtime).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowDir = join(__dirname, "..", "src", "workflows");
const outFile = join(__dirname, "..", "dist", "workflows", "browser.js");

mkdirSync(dirname(outFile), { recursive: true });

const workflows = ["triage", "implement", "seed-content"];
const lines = [];

for (const name of workflows) {
  const yaml = readFileSync(join(workflowDir, `${name}.yml`), "utf-8");
  const data = parse(yaml);
  const varName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Workflow";
  lines.push(`export const ${varName} = ${JSON.stringify(data)};`);
}

writeFileSync(outFile, lines.join("\n") + "\n");
