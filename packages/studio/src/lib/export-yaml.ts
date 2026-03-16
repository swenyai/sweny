import { stringify } from "yaml";
import type { WorkflowDefinition } from "@sweny-ai/engine";

const SCHEMA_COMMENT = "# yaml-language-server: $schema=https://sweny.ai/schemas/workflow-definition.schema.json\n";

export function exportWorkflowYaml(definition: WorkflowDefinition): string {
  return SCHEMA_COMMENT + stringify(definition, { indent: 2, lineWidth: 120 });
}
