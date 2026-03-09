import { create } from "zustand";
import { temporal } from "zundo";
import { produce } from "immer";
import type { RecipeDefinition, StateDefinition, WorkflowPhase, ExecutionEvent, StepResult } from "@sweny-ai/engine";
import { triageDefinition } from "@sweny-ai/engine";

export type StudioMode = "design" | "simulate" | "live";

export interface ExecutionSlice {
  mode: StudioMode;
  // Which state is currently executing (entered but not yet exited)
  currentStateId: string | null;
  // Results of states that have completed
  completedStates: Record<string, StepResult>;
  // Overall recipe status
  executionStatus: "idle" | "running" | "completed" | "failed" | "partial";
  // For live mode: connection info
  liveConnection: {
    url: string;
    transport: "websocket" | "sse";
    status: "disconnected" | "connecting" | "connected" | "error";
    error?: string;
  } | null;

  // Actions
  setMode(mode: StudioMode): void;
  applyEvent(event: ExecutionEvent): void;
  resetExecution(): void;
  setLiveConnection(conn: ExecutionSlice["liveConnection"]): void;
}

// What the user has selected on the canvas
export type Selection = { kind: "state"; id: string } | { kind: "edge"; source: string; outcome: string } | null;

export interface EditorState extends ExecutionSlice {
  definition: RecipeDefinition;
  selection: Selection;
  isLayoutStale: boolean; // true when structure changed and ELK needs to re-run

  // Setters
  setDefinition(def: RecipeDefinition): void;
  setSelection(sel: Selection): void;

  // State mutations (all affect `definition`)
  updateRecipeMeta(patch: Partial<Pick<RecipeDefinition, "name" | "description" | "version">>): void;
  addState(id: string, phase: WorkflowPhase): void;
  deleteState(id: string): void;
  updateState(id: string, patch: Partial<StateDefinition>): void;
  setInitial(id: string): void;

  // Transition mutations
  addTransition(sourceId: string, outcome: string, targetId: string): void;
  updateTransitionOutcome(sourceId: string, oldOutcome: string, newOutcome: string): void;
  updateTransitionTarget(sourceId: string, outcome: string, newTarget: string): void;
  deleteTransition(sourceId: string, outcome: string): void;

  markLayoutFresh(): void;
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, _get) => ({
      definition: triageDefinition as RecipeDefinition,
      selection: null,
      isLayoutStale: false,

      // ExecutionSlice initial state
      mode: "design" as StudioMode,
      currentStateId: null,
      completedStates: {},
      executionStatus: "idle" as const,
      liveConnection: null,

      setMode: (mode: StudioMode) =>
        set(
          produce((s: EditorState) => {
            s.mode = mode;
          }),
        ),

      applyEvent: (event: ExecutionEvent) =>
        set(
          produce((s: EditorState) => {
            if (event.type === "recipe:start") {
              s.currentStateId = null;
              s.completedStates = {};
              s.executionStatus = "running";
            }
            if (event.type === "state:enter") {
              s.currentStateId = event.stateId;
            }
            if (event.type === "state:exit") {
              s.currentStateId = null;
              s.completedStates[event.stateId] = event.result;
            }
            if (event.type === "recipe:end") {
              s.currentStateId = null;
              s.executionStatus = event.status;
            }
          }),
        ),

      resetExecution: () =>
        set(
          produce((s: EditorState) => {
            s.currentStateId = null;
            s.completedStates = {};
            s.executionStatus = "idle";
            s.liveConnection = null;
          }),
        ),

      setLiveConnection: (conn: ExecutionSlice["liveConnection"]) =>
        set(
          produce((s: EditorState) => {
            s.liveConnection = conn;
          }),
        ),

      setDefinition: (def: RecipeDefinition) =>
        set(
          produce((s: EditorState) => {
            s.definition = def;
            s.isLayoutStale = true;
          }),
        ),

      setSelection: (sel: Selection) =>
        set(
          produce((s: EditorState) => {
            s.selection = sel;
          }),
        ),

      markLayoutFresh: () =>
        set(
          produce((s: EditorState) => {
            s.isLayoutStale = false;
          }),
        ),

      updateRecipeMeta: (patch: Partial<Pick<RecipeDefinition, "name" | "description" | "version">>) =>
        set(
          produce((s: EditorState) => {
            if (patch.name !== undefined) s.definition.name = patch.name;
            if (patch.description !== undefined) s.definition.description = patch.description;
            if (patch.version !== undefined) s.definition.version = patch.version;
          }),
        ),

      addState: (id: string, phase: WorkflowPhase) =>
        set(
          produce((s: EditorState) => {
            if (!id || s.definition.states[id]) return;
            s.definition.states[id] = { phase };
            s.isLayoutStale = true;
          }),
        ),

      deleteState: (id: string) =>
        set(
          produce((s: EditorState) => {
            delete s.definition.states[id];
            // Remove references in other states
            for (const state of Object.values(s.definition.states)) {
              if (state.next === id) {
                delete state.next;
              }
              if (state.on) {
                for (const outcome of Object.keys(state.on)) {
                  if (state.on[outcome] === id) {
                    delete state.on[outcome];
                  }
                }
                if (Object.keys(state.on).length === 0) {
                  delete state.on;
                }
              }
            }
            // Fix initial if needed
            if (s.definition.initial === id) {
              const remaining = Object.keys(s.definition.states);
              s.definition.initial = remaining[0] ?? "";
            }
            // Clear selection if this state was selected
            if (s.selection?.kind === "state" && s.selection.id === id) {
              s.selection = null;
            }
            s.isLayoutStale = true;
          }),
        ),

      updateState: (id: string, patch: Partial<StateDefinition>) =>
        set(
          produce((s: EditorState) => {
            const state = s.definition.states[id];
            if (!state) return;
            const structural = patch.next !== undefined || patch.on !== undefined;
            if (patch.phase !== undefined) state.phase = patch.phase;
            if (patch.description !== undefined) state.description = patch.description;
            if (patch.critical !== undefined) state.critical = patch.critical;
            if (patch.next !== undefined) state.next = patch.next;
            if (patch.on !== undefined) state.on = patch.on;
            if (structural) {
              s.isLayoutStale = true;
            }
          }),
        ),

      setInitial: (id: string) =>
        set(
          produce((s: EditorState) => {
            s.definition.initial = id;
          }),
        ),

      addTransition: (sourceId: string, outcome: string, targetId: string) =>
        set(
          produce((s: EditorState) => {
            const state = s.definition.states[sourceId];
            if (!state) return;
            if (outcome === "→") {
              state.next = targetId;
            } else {
              if (!state.on) state.on = {};
              state.on[outcome] = targetId;
            }
            s.isLayoutStale = true;
          }),
        ),

      updateTransitionOutcome: (sourceId: string, oldOutcome: string, newOutcome: string) =>
        set(
          produce((s: EditorState) => {
            const state = s.definition.states[sourceId];
            if (!state) return;

            let target: string | undefined;

            if (oldOutcome === "→") {
              target = state.next;
              delete state.next;
            } else {
              target = state.on?.[oldOutcome];
              if (state.on) delete state.on[oldOutcome];
            }

            if (target === undefined) return;

            if (newOutcome === "→") {
              state.next = target;
              if (state.on && Object.keys(state.on).length === 0) {
                delete state.on;
              }
            } else {
              if (!state.on) state.on = {};
              state.on[newOutcome] = target;
            }
          }),
        ),

      updateTransitionTarget: (sourceId: string, outcome: string, newTarget: string) =>
        set(
          produce((s: EditorState) => {
            const state = s.definition.states[sourceId];
            if (!state) return;
            if (outcome === "→") {
              state.next = newTarget;
            } else if (state.on) {
              state.on[outcome] = newTarget;
            }
          }),
        ),

      deleteTransition: (sourceId: string, outcome: string) =>
        set(
          produce((s: EditorState) => {
            const state = s.definition.states[sourceId];
            if (!state) return;
            if (outcome === "→") {
              delete state.next;
            } else {
              if (state.on) {
                delete state.on[outcome];
                if (Object.keys(state.on).length === 0) {
                  delete state.on;
                }
              }
            }
            s.isLayoutStale = true;
          }),
        ),
    }),
    {
      // Only track `definition` in undo history — not selection or isLayoutStale
      partialize: (state) => ({ definition: state.definition }),
    },
  ),
);

// Expose the temporal API for undo/redo
// useEditorStore.temporal is typed via the zundo mutation: ['temporal', StoreApi<TemporalState<...>>]
export const useTemporalStore = () => useEditorStore.temporal;
