import { create } from "zustand";
import { temporal } from "zundo";
import { produce } from "immer";
import type { WorkflowDefinition, StepDefinition, WorkflowPhase, ExecutionEvent, StepResult } from "@sweny-ai/engine";
import { triageDefinition } from "@sweny-ai/engine";

export type StudioMode = "design" | "simulate" | "live";

export interface ExecutionSlice {
  mode: StudioMode;
  // Which step is currently executing (entered but not yet exited)
  currentStepId: string | null;
  // Results of steps that have completed
  completedSteps: Record<string, StepResult>;
  // Overall workflow status
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
export type Selection = { kind: "step"; id: string } | { kind: "edge"; source: string; outcome: string } | null;

export interface EditorState extends ExecutionSlice {
  definition: WorkflowDefinition;
  selection: Selection;
  isLayoutStale: boolean; // true when structure changed and ELK needs to re-run

  // Setters
  setDefinition(def: WorkflowDefinition): void;
  setSelection(sel: Selection): void;

  // Step mutations (all affect `definition`)
  updateWorkflowMeta(patch: Partial<Pick<WorkflowDefinition, "name" | "description" | "version">>): void;
  addStep(id: string, phase: WorkflowPhase): void;
  deleteStep(id: string): void;
  updateStep(id: string, patch: Partial<StepDefinition>): void;
  /** Rename a step ID and cascade all references. Returns an error string on failure, null on success. */
  renameStep(oldId: string, newId: string): string | null;
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
    (set, get) => ({
      definition: triageDefinition as WorkflowDefinition,
      selection: null,
      isLayoutStale: false,

      // ExecutionSlice initial state
      mode: "design" as StudioMode,
      currentStepId: null,
      completedSteps: {},
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
            if (event.type === "workflow:start") {
              s.currentStepId = null;
              s.completedSteps = {};
              s.executionStatus = "running";
            }
            if (event.type === "step:enter") {
              s.currentStepId = event.stepId;
            }
            if (event.type === "step:exit") {
              s.currentStepId = null;
              s.completedSteps[event.stepId] = event.result;
            }
            if (event.type === "workflow:end") {
              s.currentStepId = null;
              s.executionStatus = event.status;
            }
          }),
        ),

      resetExecution: () =>
        set(
          produce((s: EditorState) => {
            s.currentStepId = null;
            s.completedSteps = {};
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

      setDefinition: (def: WorkflowDefinition) =>
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

      updateWorkflowMeta: (patch: Partial<Pick<WorkflowDefinition, "name" | "description" | "version">>) =>
        set(
          produce((s: EditorState) => {
            if (patch.name !== undefined) s.definition.name = patch.name;
            if (patch.description !== undefined) s.definition.description = patch.description;
            if (patch.version !== undefined) s.definition.version = patch.version;
          }),
        ),

      addStep: (id: string, phase: WorkflowPhase) =>
        set(
          produce((s: EditorState) => {
            if (!id || s.definition.steps[id]) return;
            s.definition.steps[id] = { phase };
            s.isLayoutStale = true;
          }),
        ),

      deleteStep: (id: string) =>
        set(
          produce((s: EditorState) => {
            delete s.definition.steps[id];
            // Remove references in other steps
            for (const step of Object.values(s.definition.steps)) {
              if (step.next === id) {
                delete step.next;
              }
              if (step.on) {
                for (const outcome of Object.keys(step.on)) {
                  if (step.on[outcome] === id) {
                    delete step.on[outcome];
                  }
                }
                if (Object.keys(step.on).length === 0) {
                  delete step.on;
                }
              }
            }
            // Fix initial if needed
            if (s.definition.initial === id) {
              const remaining = Object.keys(s.definition.steps);
              s.definition.initial = remaining[0] ?? "";
            }
            // Clear selection if this step was selected
            if (s.selection?.kind === "step" && s.selection.id === id) {
              s.selection = null;
            }
            s.isLayoutStale = true;
          }),
        ),

      updateStep: (id: string, patch: Partial<StepDefinition>) =>
        set(
          produce((s: EditorState) => {
            const step = s.definition.steps[id];
            if (!step) return;
            const structural = patch.next !== undefined || patch.on !== undefined;
            if (patch.phase !== undefined) step.phase = patch.phase;
            if (patch.description !== undefined) step.description = patch.description;
            if (patch.critical !== undefined) step.critical = patch.critical;
            if ("type" in patch) {
              if (patch.type === undefined) {
                delete step.type;
              } else {
                step.type = patch.type;
              }
            }
            if (patch.next !== undefined) step.next = patch.next;
            if (patch.on !== undefined) step.on = patch.on;
            if (structural) {
              s.isLayoutStale = true;
            }
          }),
        ),

      renameStep: (oldId: string, newId: string): string | null => {
        const trimmed = newId.trim();
        if (!trimmed) return "Step ID cannot be empty";
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
          return "Step IDs may only contain letters, digits, hyphens, and underscores";
        }
        if (trimmed === oldId) return null;
        const state = get();
        if (state.definition.steps[trimmed]) {
          return `A step with ID "${trimmed}" already exists`;
        }
        if (!state.definition.steps[oldId]) {
          return `Step "${oldId}" does not exist`;
        }
        set(
          produce((s: EditorState) => {
            const step = s.definition.steps[oldId];
            s.definition.steps[trimmed] = step;
            delete s.definition.steps[oldId];
            if (s.definition.initial === oldId) s.definition.initial = trimmed;
            for (const st of Object.values(s.definition.steps)) {
              if (st.next === oldId) st.next = trimmed;
              if (st.on) {
                for (const outcome of Object.keys(st.on)) {
                  if (st.on[outcome] === oldId) st.on[outcome] = trimmed;
                }
              }
            }
            if (s.selection?.kind === "step" && s.selection.id === oldId) {
              s.selection = { kind: "step", id: trimmed };
            }
            s.isLayoutStale = true;
          }),
        );
        return null;
      },

      setInitial: (id: string) =>
        set(
          produce((s: EditorState) => {
            s.definition.initial = id;
          }),
        ),

      addTransition: (sourceId: string, outcome: string, targetId: string) =>
        set(
          produce((s: EditorState) => {
            const step = s.definition.steps[sourceId];
            if (!step) return;
            if (outcome === "→") {
              step.next = targetId;
            } else {
              if (!step.on) step.on = {};
              step.on[outcome] = targetId;
            }
            s.isLayoutStale = true;
          }),
        ),

      updateTransitionOutcome: (sourceId: string, oldOutcome: string, newOutcome: string) =>
        set(
          produce((s: EditorState) => {
            const step = s.definition.steps[sourceId];
            if (!step) return;

            let target: string | undefined;

            if (oldOutcome === "→") {
              target = step.next;
              delete step.next;
            } else {
              target = step.on?.[oldOutcome];
              if (step.on) delete step.on[oldOutcome];
            }

            if (target === undefined) return;

            if (newOutcome === "→") {
              step.next = target;
              if (step.on && Object.keys(step.on).length === 0) {
                delete step.on;
              }
            } else {
              if (!step.on) step.on = {};
              step.on[newOutcome] = target;
            }
          }),
        ),

      updateTransitionTarget: (sourceId: string, outcome: string, newTarget: string) =>
        set(
          produce((s: EditorState) => {
            const step = s.definition.steps[sourceId];
            if (!step) return;
            if (outcome === "→") {
              step.next = newTarget;
            } else if (step.on) {
              step.on[outcome] = newTarget;
            }
          }),
        ),

      deleteTransition: (sourceId: string, outcome: string) =>
        set(
          produce((s: EditorState) => {
            const step = s.definition.steps[sourceId];
            if (!step) return;
            if (outcome === "→") {
              delete step.next;
            } else {
              if (step.on) {
                delete step.on[outcome];
                if (Object.keys(step.on).length === 0) {
                  delete step.on;
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
