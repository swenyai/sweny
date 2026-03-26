import { stringify } from "yaml";
import type { Workflow } from "@sweny-ai/core";

const WORKFLOW_YAML_HEADER = `# SWEny Workflow Definition
# https://sweny.ai/docs/workflows
# Schema: @sweny-ai/core Workflow type
---
`;

export function exportWorkflowYaml(workflow: Workflow): string {
  return WORKFLOW_YAML_HEADER + stringify(workflow, { indent: 2, lineWidth: 120 });
}
