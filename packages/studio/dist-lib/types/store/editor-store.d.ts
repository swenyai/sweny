import type { RecipeDefinition, StateDefinition, WorkflowPhase, ExecutionEvent, StepResult } from "@sweny-ai/engine";
export type StudioMode = "design" | "simulate" | "live";
export interface ExecutionSlice {
  mode: StudioMode;
  currentStateId: string | null;
  completedStates: Record<string, StepResult>;
  executionStatus: "idle" | "running" | "completed" | "failed" | "partial";
  liveConnection: {
    url: string;
    transport: "websocket" | "sse";
    status: "disconnected" | "connecting" | "connected" | "error";
    error?: string;
  } | null;
  setMode(mode: StudioMode): void;
  applyEvent(event: ExecutionEvent): void;
  resetExecution(): void;
  setLiveConnection(conn: ExecutionSlice["liveConnection"]): void;
}
export type Selection =
  | {
      kind: "state";
      id: string;
    }
  | {
      kind: "edge";
      source: string;
      outcome: string;
    }
  | null;
export interface EditorState extends ExecutionSlice {
  definition: RecipeDefinition;
  selection: Selection;
  isLayoutStale: boolean;
  setDefinition(def: RecipeDefinition): void;
  setSelection(sel: Selection): void;
  updateRecipeMeta(patch: Partial<Pick<RecipeDefinition, "name" | "description" | "version">>): void;
  addState(id: string, phase: WorkflowPhase): void;
  deleteState(id: string): void;
  updateState(id: string, patch: Partial<StateDefinition>): void;
  setInitial(id: string): void;
  addTransition(sourceId: string, outcome: string, targetId: string): void;
  updateTransitionOutcome(sourceId: string, oldOutcome: string, newOutcome: string): void;
  updateTransitionTarget(sourceId: string, outcome: string, newTarget: string): void;
  deleteTransition(sourceId: string, outcome: string): void;
  markLayoutFresh(): void;
}
export declare const useEditorStore: import("zustand").UseBoundStore<
  Omit<import("zustand").StoreApi<EditorState>, "temporal"> & {
    temporal: import("zustand").StoreApi<
      import("zundo").TemporalState<{
        definition: RecipeDefinition;
      }>
    >;
  }
>;
export declare const useTemporalStore: () => import("zustand").StoreApi<
  import("zundo").TemporalState<{
    definition: RecipeDefinition;
  }>
>;
