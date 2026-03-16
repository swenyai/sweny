import { stringify } from "yaml";
import { WORKFLOW_YAML_SCHEMA_HEADER } from "@sweny-ai/engine/browser";
import type { WorkflowDefinition } from "@sweny-ai/engine/browser";

export function exportWorkflowYaml(definition: WorkflowDefinition): string {
  return WORKFLOW_YAML_SCHEMA_HEADER + stringify(definition, { indent: 2, lineWidth: 120 });
}
