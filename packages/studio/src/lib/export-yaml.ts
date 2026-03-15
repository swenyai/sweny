import { stringify } from "yaml";
import type { WorkflowDefinition } from "@sweny-ai/engine";

export function exportWorkflowYaml(definition: WorkflowDefinition): string {
  return stringify(definition, { indent: 2, lineWidth: 120 });
}
