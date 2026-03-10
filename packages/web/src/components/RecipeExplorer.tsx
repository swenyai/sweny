import { useState } from "react";
import { RecipeViewer } from "@sweny-ai/studio/viewer";
import { triageDefinition, implementDefinition } from "@sweny-ai/engine/browser";
import "@sweny-ai/studio/style.css";
import type { RecipeDefinition, StateDefinition } from "@sweny-ai/engine/browser";

// ── Data ─────────────────────────────────────────────────────────────────────

const RECIPES: { id: string; label: string; description: string; definition: RecipeDefinition }[] = [
  {
    id: "triage",
    label: "Triage",
    description: "Monitors production logs, investigates novel errors, implements fixes, and opens PRs — autonomously.",
    definition: triageDefinition as RecipeDefinition,
  },
  {
    id: "implement",
    label: "Implement",
    description: "Takes an existing issue identifier and produces a reviewed PR with a working fix.",
    definition: implementDefinition as RecipeDefinition,
  },
];

const PHASE_META = {
  learn: { label: "Learn", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  act: { label: "Act", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  report: { label: "Report", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function recipeStats(definition: RecipeDefinition) {
  const states = Object.values(definition.states);
  return {
    total: states.length,
    learn: states.filter((s) => s.phase === "learn").length,
    act: states.filter((s) => s.phase === "act").length,
    report: states.filter((s) => s.phase === "report").length,
  };
}

function outboundTransitions(stateId: string, state: StateDefinition, definition: RecipeDefinition) {
  const transitions: { label: string; target: string }[] = [];
  if (state.on) {
    for (const [outcome, target] of Object.entries(state.on)) {
      transitions.push({ label: outcome, target });
    }
  }
  if (state.next && !transitions.some((t) => t.target === state.next)) {
    transitions.push({ label: "→", target: state.next });
  }
  // Check who points to this state
  return transitions;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PhasePill({ phase }: { phase: keyof typeof PHASE_META }) {
  const { label, color, bg } = PHASE_META[phase];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: "0.7rem",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color,
        background: bg,
        border: `1px solid ${color}33`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

interface NodeDetailProps {
  stateId: string;
  state: StateDefinition;
  isInitial: boolean;
  definition: RecipeDefinition;
  onClose: () => void;
}

function NodeDetail({ stateId, state, isInitial, definition, onClose }: NodeDetailProps) {
  const transitions = outboundTransitions(stateId, state, definition);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "16px",
        height: "100%",
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <PhasePill phase={state.phase} />
            {isInitial && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  color: "#6366f1",
                  background: "rgba(99,102,241,0.1)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                INITIAL
              </span>
            )}
            {state.critical && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  color: "#ef4444",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                CRITICAL
              </span>
            )}
          </div>
          <div
            style={{
              fontFamily: "var(--sl-font-mono, monospace)",
              fontSize: "0.9rem",
              fontWeight: 700,
              color: "var(--sl-color-text, #f1f5f9)",
              wordBreak: "break-all",
            }}
          >
            {stateId}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            flexShrink: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--sl-color-gray-3, #94a3b8)",
            padding: 2,
            lineHeight: 1,
            fontSize: "1.1rem",
          }}
        >
          ✕
        </button>
      </div>

      {/* Description */}
      {state.description ? (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--sl-color-gray-2, #cbd5e1)", lineHeight: 1.5 }}>
          {state.description}
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--sl-color-gray-4, #475569)", fontStyle: "italic" }}>
          No description.
        </p>
      )}

      {/* Transitions */}
      {transitions.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--sl-color-gray-3, #94a3b8)",
              marginBottom: 8,
            }}
          >
            Transitions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {transitions.map(({ label, target }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "0.75rem",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6,
                  padding: "4px 8px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--sl-font-mono, monospace)",
                    color:
                      label === "failed" ? "#f87171" : label === "→" ? "var(--sl-color-gray-3, #94a3b8)" : "#a78bfa",
                    fontWeight: 600,
                    minWidth: 60,
                  }}
                >
                  {label}
                </span>
                <span style={{ color: "var(--sl-color-gray-3, #94a3b8)" }}>→</span>
                <span style={{ fontFamily: "var(--sl-font-mono, monospace)", color: "var(--sl-color-text, #f1f5f9)" }}>
                  {target === "end" ? <em style={{ color: "var(--sl-color-gray-3, #94a3b8)" }}>end</em> : target}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {transitions.length === 0 && (
        <div style={{ fontSize: "0.75rem", color: "var(--sl-color-gray-3, #94a3b8)", fontStyle: "italic" }}>
          Terminal state — recipe ends here.
        </div>
      )}
    </div>
  );
}

function RecipeOverview({ recipe }: { recipe: (typeof RECIPES)[number] }) {
  const stats = recipeStats(recipe.definition);
  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div
          style={{
            fontSize: "0.65rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--sl-color-gray-3, #94a3b8)",
            marginBottom: 6,
          }}
        >
          Recipe
        </div>
        <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--sl-color-text, #f1f5f9)", marginBottom: 6 }}>
          {recipe.label}
        </div>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--sl-color-gray-2, #cbd5e1)", lineHeight: 1.55 }}>
          {recipe.description}
        </p>
      </div>

      <div>
        <div
          style={{
            fontSize: "0.65rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--sl-color-gray-3, #94a3b8)",
            marginBottom: 8,
          }}
        >
          Phases
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(["learn", "act", "report"] as const).map((phase) => {
            const { label, color, bg } = PHASE_META[phase];
            const count = stats[phase];
            const pct = Math.round((count / stats.total) * 100);
            return (
              <div key={phase}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}
                >
                  <span style={{ fontSize: "0.72rem", fontWeight: 600, color }}>{label}</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--sl-color-gray-3, #94a3b8)" }}>{count}</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, opacity: 0.7 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 4, fontSize: "0.72rem", color: "var(--sl-color-gray-3, #94a3b8)", lineHeight: 1.5 }}>
        <span style={{ color: "var(--sl-color-text, #f1f5f9)", fontWeight: 600 }}>{stats.total} states</span> total.
        Click any node to inspect its phase, routing, and transitions.
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RecipeExplorer() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);

  const recipe = RECIPES[activeIdx];
  const selectedState = selectedStateId ? recipe.definition.states[selectedStateId] : null;

  function switchRecipe(idx: number) {
    setActiveIdx(idx);
    setSelectedStateId(null);
  }

  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.1)",
        overflow: "hidden",
        background: "var(--sl-color-bg-sidebar, #0f172a)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        {RECIPES.map((r, i) => (
          <button
            key={r.id}
            onClick={() => switchRecipe(i)}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              border: "1px solid",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: 600,
              transition: "all 0.15s",
              background: activeIdx === i ? "#6366f1" : "transparent",
              color: activeIdx === i ? "#fff" : "var(--sl-color-gray-2, #94a3b8)",
              borderColor: activeIdx === i ? "#6366f1" : "rgba(255,255,255,0.12)",
            }}
          >
            {r.label}
          </button>
        ))}

        {/* Phase legend — right-aligned */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {(["learn", "act", "report"] as const).map((phase) => {
            const { label, color } = PHASE_META[phase];
            return (
              <div key={phase} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.8, flexShrink: 0 }}
                />
                <span style={{ fontSize: "0.7rem", color: "var(--sl-color-gray-3, #94a3b8)" }}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Body: graph + side panel */}
      <div style={{ display: "flex", height: 520 }}>
        {/* Graph */}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <RecipeViewer
            key={recipe.id}
            definition={recipe.definition}
            height={520}
            onNodeClick={(id) => setSelectedStateId((prev) => (prev === id ? null : id))}
          />
        </div>

        {/* Side panel */}
        <div
          style={{
            width: selectedState ? 240 : 200,
            flexShrink: 0,
            borderLeft: "1px solid rgba(255,255,255,0.08)",
            overflowY: "auto",
            transition: "width 0.2s ease",
          }}
        >
          {selectedState ? (
            <NodeDetail
              stateId={selectedStateId!}
              state={selectedState}
              isInitial={selectedStateId === recipe.definition.initial}
              definition={recipe.definition}
              onClose={() => setSelectedStateId(null)}
            />
          ) : (
            <RecipeOverview recipe={recipe} />
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "6px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: "0.68rem",
          color: "var(--sl-color-gray-4, #475569)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Scroll to zoom · drag to pan · click a node to inspect</span>
        <a
          href="https://github.com/swenyai/sweny"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "inherit", textDecoration: "none" }}
        >
          @sweny-ai/engine
        </a>
      </div>
    </div>
  );
}
