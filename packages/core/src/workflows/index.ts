import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Workflow } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadBuiltinWorkflow(filename: string): Workflow {
  const filePath = path.join(__dirname, filename);
  return parseYaml(fs.readFileSync(filePath, "utf-8")) as Workflow;
}

export const triageWorkflow: Workflow = loadBuiltinWorkflow("triage.yml");
export const implementWorkflow: Workflow = loadBuiltinWorkflow("implement.yml");
export const seedContentWorkflow: Workflow = loadBuiltinWorkflow("seed-content.yml");
