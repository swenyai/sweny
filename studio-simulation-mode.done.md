# Task: Studio — Simulation Mode + Live Execution Connection

## Prerequisites
`engine-execution-observer.done.md` must exist before starting.
The `ExecutionEvent`, `RunObserver`, `CollectingObserver`, `runRecipe`, `createRecipe`,
and `createProviderRegistry` must be exported from `@sweny-ai/engine` (via the browser alias).

## Goal
Add two execution modes to the studio:

**Simulate** — run a mock recipe in the browser. Each state suspends and the user
manually chooses the outcome (success/skipped/failed + optional named outcome). The graph
highlights the current state, completed states, and failed states in real-time.

**Live** — connect to a remote engine process over WebSocket or SSE. Receive
`ExecutionEvent` JSON messages and drive the same visual highlighting. This is the cloud
product hook: a deployed engine streams events, the studio visualizes them.

Both modes use the same `ExecutionSlice` store and the same `RecipeViewer` highlighting.

## Architecture

```
store/
  editor-store.ts     ← (exists) add ExecutionSlice
components/
  SimulationPanel.tsx ← NEW: bottom panel, shown when mode !== "design"
  LiveConnectPanel.tsx← NEW: connection form for WebSocket/SSE
RecipeViewer.tsx      ← (update) apply execution highlighting to nodes/edges
App.tsx               ← (update) add mode toggle and panels
```

---

## Step 1: ExecutionSlice in the Zustand store

Add to `editor-store.ts`:

```typescript
import type { ExecutionEvent, StepResult } from "@sweny-ai/engine";

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
```

Implement `applyEvent` to drive the visual state:
```typescript
applyEvent: (event) => set(produce((s: EditorState) => {
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
})),
```

`resetExecution`:
```typescript
resetExecution: () => set(produce((s: EditorState) => {
  s.currentStateId = null;
  s.completedStates = {};
  s.executionStatus = "idle";
  s.liveConnection = null;
})),
```

**Important**: `ExecutionSlice` state is NOT tracked in the undo history.
Update the `partialize` option to continue excluding it:
```typescript
partialize: (state) => ({ definition: state.definition }),
```

---

## Step 2: Visual highlighting in RecipeViewer

The `RecipeViewer` must apply execution state to node styles.

Add a helper that computes a node's execution status:
```typescript
type NodeExecStatus = "current" | "success" | "failed" | "skipped" | "pending";

function getNodeExecStatus(
  nodeId: string,
  currentStateId: string | null,
  completedStates: Record<string, StepResult>,
  mode: StudioMode,
): NodeExecStatus {
  if (mode === "design") return "pending";
  if (nodeId === currentStateId) return "current";
  const result = completedStates[nodeId];
  if (!result) return "pending";
  return result.status; // "success" | "failed" | "skipped"
}
```

Add an `execStatus` field to `StateNodeData`:
```typescript
export type StateNodeData = {
  stateId: string;
  state: StateDefinition;
  isInitial: boolean;
  isTerminal: boolean;
  execStatus: NodeExecStatus;  // NEW
};
```

In `StateNode.tsx`, apply a ring based on `execStatus`:
```typescript
const execRing: Record<NodeExecStatus, string> = {
  current:  "ring-2 ring-blue-500 ring-offset-1 animate-pulse",
  success:  "ring-2 ring-green-400",
  failed:   "ring-2 ring-red-500",
  skipped:  "ring-2 ring-gray-400",
  pending:  "",
};
```

And a background tint:
```typescript
const execBg: Record<NodeExecStatus, string> = {
  current:  "bg-blue-50",
  success:  "bg-green-50",
  failed:   "bg-red-50",
  skipped:  "bg-gray-50",
  pending:  "bg-white",
};
```

In `RecipeViewer`, when building nodes from the layout, include `execStatus`:
```typescript
const execStatus = getNodeExecStatus(node.id, currentStateId, completedStates, mode);
const nodeData: StateNodeData = { ..., execStatus };
```

Re-apply `execStatus` when `currentStateId` or `completedStates` changes WITHOUT re-running ELK:
```typescript
useEffect(() => {
  setNodes((prev) => prev.map((node) => ({
    ...node,
    data: {
      ...node.data,
      execStatus: getNodeExecStatus(node.id, currentStateId, completedStates, mode),
      selected: selection?.kind === "state" && selection.id === node.id,
    },
  })));
}, [currentStateId, completedStates, mode, selection]);
```

---

## Step 3: Simulation Panel (`SimulationPanel.tsx`)

This component appears at the bottom of the screen when `mode === "simulate"`.

### Design

```
┌─────────────────────────────────────────────────────────────────────┐
│ ● Simulating: triage                   [Reset]                       │
│ Current: novelty-gate (act)                                          │
│                                                                      │
│ Resolve as: [outcome: implement ▼]  [Status: success ▼]  [→ Step]   │
│             (type custom outcome or pick: skip / implement / failed) │
│                                                                      │
│ Completed: verify-access ✓  build-context ✓  investigate ✓          │
└─────────────────────────────────────────────────────────────────────┘
```

### State this panel needs

- `currentStateId` — shows "Current: {id} ({phase})"
- `completedStates` — shows completed list with status icons
- `executionStatus` — shows "Simulating" / "Completed" / "Failed"
- A way to "resolve" the current state with a chosen outcome

### The mock runner design

When the user clicks "Start Simulation", the panel:
1. Creates a mock `Recipe` from the current `definition` using `createRecipe`
2. Each mock implementation suspends until the user resolves it:

```typescript
// A deferred promise that the UI resolves
class StepLatch {
  private resolve!: (result: StepResult) => void;
  readonly promise: Promise<StepResult> = new Promise((r) => { this.resolve = r; });
  complete(result: StepResult) { this.resolve(result); }
}

// Store one latch per simulation run (only one state runs at a time)
let activeLatch: StepLatch | null = null;

function createMockImplementations(stateIds: string[]) {
  return Object.fromEntries(
    stateIds.map((id) => [
      id,
      async (): Promise<StepResult> => {
        activeLatch = new StepLatch();
        return activeLatch.promise;
      },
    ])
  );
}
```

When the user clicks "→ Step":
```typescript
function handleStep(outcome: string, status: "success" | "skipped" | "failed") {
  const result: StepResult = {
    status,
    data: outcome && outcome !== status ? { outcome } : undefined,
  };
  activeLatch?.complete(result);
}
```

Start simulation:
```typescript
async function startSimulation() {
  const { definition, applyEvent, setMode } = useEditorStore.getState();
  setMode("simulate");
  resetExecution();

  const mockImpls = createMockImplementations(Object.keys(definition.states));
  const recipe = createRecipe(definition, mockImpls);
  const providers = createProviderRegistry();

  const observer: RunObserver = {
    onEvent(event) { applyEvent(event); }
  };

  await runRecipe(recipe, {}, providers, { observer });
}
```

Note: `runRecipe` runs in the background (don't await in the UI event handler directly).
Use `.then()` or wrap in an async IIFE.

### Component structure

```tsx
export function SimulationPanel() {
  const { currentStateId, completedStates, executionStatus, definition, resetExecution } = useEditorStore();
  const [outcome, setOutcome] = useState("success");
  const [customOutcome, setCustomOutcome] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const currentState = currentStateId ? definition.states[currentStateId] : null;
  const completedList = Object.entries(completedStates);
  const effectiveOutcome = customOutcome.trim() || outcome;

  function handleStart() {
    setIsRunning(true);
    startSimulation().finally(() => setIsRunning(false));
  }

  function handleStep() {
    activeLatch?.complete({
      status: outcome as StepResult["status"],
      data: customOutcome.trim() ? { outcome: customOutcome.trim() } : undefined,
    });
    setCustomOutcome("");
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 flex-shrink-0">
      {/* Header row */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-semibold text-gray-700">
          {executionStatus === "idle" ? "Simulation" : `Simulating: ${definition.name}`}
        </span>
        {executionStatus !== "idle" && (
          <span className={`text-xs px-2 py-0.5 rounded ${
            executionStatus === "running"   ? "bg-blue-100 text-blue-700" :
            executionStatus === "completed" ? "bg-green-100 text-green-700" :
            "bg-red-100 text-red-700"
          }`}>{executionStatus}</span>
        )}
        <div className="flex-1" />
        {executionStatus === "idle" ? (
          <button onClick={handleStart} disabled={isRunning}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40">
            ▶ Start
          </button>
        ) : (
          <button onClick={() => { resetExecution(); setIsRunning(false); }}
            className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-500">
            ↺ Reset
          </button>
        )}
      </div>

      {/* Current state + step controls */}
      {currentState && currentStateId && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">
            Current: <code className="bg-gray-100 px-1 rounded">{currentStateId}</code>
            <span className="ml-1 text-gray-400">({currentState.phase})</span>
          </span>
          <div className="flex-1" />
          <input
            value={customOutcome}
            onChange={(e) => setCustomOutcome(e.target.value)}
            placeholder="outcome (optional)"
            className="px-2 py-1 text-xs border border-gray-300 rounded w-36"
          />
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-300 rounded"
          >
            <option value="success">success</option>
            <option value="skipped">skipped</option>
            <option value="failed">failed</option>
          </select>
          <button onClick={handleStep}
            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500">
            → Step
          </button>
        </div>
      )}

      {/* Completed list */}
      {completedList.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {completedList.map(([id, result]) => (
            <span key={id} className={`text-xs px-1.5 py-0.5 rounded ${
              result.status === "success" ? "bg-green-100 text-green-700" :
              result.status === "failed"  ? "bg-red-100 text-red-700" :
              "bg-gray-100 text-gray-600"
            }`}>
              {id} {result.status === "success" ? "✓" : result.status === "failed" ? "✗" : "−"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Step 4: Live Connection Panel (`LiveConnectPanel.tsx`)

When `mode === "live"`, show a connection panel instead of SimulationPanel.

```tsx
export function LiveConnectPanel() {
  const { liveConnection, setLiveConnection, applyEvent, resetExecution, setMode } = useEditorStore();
  const [url, setUrl] = useState("ws://localhost:4000/events");
  const [transport, setTransport] = useState<"websocket" | "sse">("websocket");
  const wsRef = useRef<WebSocket | null>(null);
  const evsRef = useRef<EventSource | null>(null);

  function connect() {
    resetExecution();
    setLiveConnection({ url, transport, status: "connecting" });

    if (transport === "websocket") {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () =>
        setLiveConnection({ url, transport, status: "connected" });

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as ExecutionEvent;
          applyEvent(event);
        } catch { /* ignore malformed */ }
      };

      ws.onerror = () =>
        setLiveConnection({ url, transport, status: "error", error: "WebSocket error" });

      ws.onclose = () =>
        setLiveConnection((prev) => prev ? { ...prev, status: "disconnected" } : null);

    } else {
      // SSE
      const es = new EventSource(url);
      evsRef.current = es;

      es.onopen = () =>
        setLiveConnection({ url, transport, status: "connected" });

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as ExecutionEvent;
          applyEvent(event);
        } catch { /* ignore malformed */ }
      };

      es.onerror = () =>
        setLiveConnection({ url, transport, status: "error", error: "SSE error" });
    }
  }

  function disconnect() {
    wsRef.current?.close();
    evsRef.current?.close();
    setLiveConnection(null);
    setMode("design");
    resetExecution();
  }

  const isConnected = liveConnection?.status === "connected";
  const isConnecting = liveConnection?.status === "connecting";

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">Live Execution</span>
        {liveConnection && (
          <span className={`text-xs px-2 py-0.5 rounded ${
            isConnected  ? "bg-green-100 text-green-700" :
            isConnecting ? "bg-yellow-100 text-yellow-700" :
            liveConnection.status === "error" ? "bg-red-100 text-red-700" :
            "bg-gray-100 text-gray-600"
          }`}>
            {liveConnection.status}
          </span>
        )}
        <div className="flex-1" />
        {!isConnected && !isConnecting && (
          <>
            <select value={transport} onChange={(e) => setTransport(e.target.value as "websocket" | "sse")}
              className="px-2 py-1 text-xs border border-gray-300 rounded">
              <option value="websocket">WebSocket</option>
              <option value="sse">SSE</option>
            </select>
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="ws://host/events"
              className="px-2 py-1 text-xs border border-gray-300 rounded w-56" />
            <button onClick={connect}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500">
              Connect
            </button>
          </>
        )}
        {(isConnected || isConnecting) && (
          <button onClick={disconnect}
            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500">
            Disconnect
          </button>
        )}
      </div>
      {liveConnection?.error && (
        <p className="text-xs text-red-600 mt-1">{liveConnection.error}</p>
      )}
    </div>
  );
}
```

---

## Step 5: Update Toolbar with mode toggle

Add to `Toolbar.tsx` a mode toggle group (Design | Simulate | Live):

```tsx
const mode = useEditorStore((s) => s.mode);
const setMode = useEditorStore((s) => s.setMode);
const resetExecution = useEditorStore((s) => s.resetExecution);

function switchMode(newMode: StudioMode) {
  if (newMode !== mode) {
    resetExecution();
    setMode(newMode);
  }
}

// In JSX, add after the recipe switcher:
<div className="flex rounded overflow-hidden border border-gray-600 mr-2">
  {(["design", "simulate", "live"] as StudioMode[]).map((m) => (
    <button key={m} onClick={() => switchMode(m)}
      className={`px-3 py-1 text-xs ${mode === m ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>
      {m}
    </button>
  ))}
</div>
```

Also: in design mode, the PropertiesPanel shows (right sidebar).
In simulate/live mode, hide the PropertiesPanel (canvas is full width; the bottom panel takes over).

---

## Step 6: Update App.tsx

```tsx
<div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
  <Toolbar ... />
  <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1 }}>
        <RecipeViewer />
      </div>
      {/* Bottom execution panel */}
      {mode === "simulate" && <SimulationPanel />}
      {mode === "live"     && <LiveConnectPanel />}
    </div>
    {/* Right sidebar — design mode only */}
    {mode === "design" && <PropertiesPanel />}
  </div>
</div>
```

---

## Step 7: Cleanup on unmount

In `LiveConnectPanel`, add a `useEffect` cleanup:
```typescript
useEffect(() => {
  return () => {
    wsRef.current?.close();
    evsRef.current?.close();
  };
}, []);
```

---

## Success criteria
1. Design/Simulate/Live mode toggle visible in toolbar
2. Clicking "▶ Start" in Simulate mode begins the mock runner and highlights `verify-access` as current
3. Clicking "→ Step" with outcome "success" completes the state and advances to the next
4. Choosing outcome "implement" with custom outcome field drives `on["implement"]` routing
5. Completed states show green ring on canvas; failed states show red ring; current state pulses blue
6. Live mode: entering a WebSocket URL and clicking Connect shows "connecting" → "connected" status
7. Live mode: after connecting, sending a `state:enter` JSON message via WebSocket updates the canvas
8. Switching modes resets execution state
9. `npm run typecheck` passes — no `any` types in new code
10. `npm run build` passes

## Commit when done
```
git add packages/studio/
git commit -m "feat(studio): simulation mode + live execution connection via WebSocket/SSE"
```
Then rename: `mv studio-simulation-mode.todo.md studio-simulation-mode.done.md`
