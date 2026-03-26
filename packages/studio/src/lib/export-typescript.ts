import type { Workflow } from "@sweny-ai/core";
import { exportAsTypescript as coreExport } from "@sweny-ai/core/studio";

/**
 * Generate a TypeScript workflow file from a Workflow definition.
 * Delegates to the core studio adapter.
 */
export function exportAsTypescript(workflow: Workflow): string {
  return coreExport(workflow);
}
