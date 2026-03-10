import "@xyflow/react/dist/style.css";
import type { RecipeDefinition } from "@sweny-ai/engine";
export interface RecipeViewerProps {
  /** The RecipeDefinition to visualize. */
  definition: RecipeDefinition;
  /**
   * Highlight these state ids (e.g. from a live execution).
   * Keys are state ids, values are the execution status.
   */
  executionState?: Record<string, "current" | "success" | "failed" | "skipped">;
  /** Canvas height. Defaults to "100%". */
  height?: string | number;
  /** Called when the user clicks a node. */
  onNodeClick?: (stateId: string) => void;
}
export declare function RecipeViewer({
  definition,
  executionState,
  height,
  onNodeClick,
}: RecipeViewerProps): import("react/jsx-runtime").JSX.Element;
