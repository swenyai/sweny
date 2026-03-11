import { useState, useEffect, useRef, useCallback } from "react";
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

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = "visual" | "split" | "source";

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

function outboundTransitions(state: StateDefinition) {
  const transitions: { label: string; target: string }[] = [];
  if (state.on) {
    for (const [outcome, target] of Object.entries(state.on)) {
      transitions.push({ label: outcome, target });
    }
  }
  if (state.next && !transitions.some((t) => t.target === state.next)) {
    transitions.push({ label: "→", target: state.next });
  }
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
  onClose: () => void;
}

function NodeDetail({ stateId, state, isInitial, onClose }: NodeDetailProps) {
  const transitions = outboundTransitions(state);

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
              color: "#f1f5f9",
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
            color: "#94a3b8",
            padding: 2,
            lineHeight: 1,
            fontSize: "1.1rem",
          }}
        >
          ✕
        </button>
      </div>

      {state.description ? (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#cbd5e1", lineHeight: 1.5 }}>{state.description}</p>
      ) : (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#475569", fontStyle: "italic" }}>No description.</p>
      )}

      {transitions.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#94a3b8",
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
                    color: label === "failed" ? "#f87171" : label === "→" ? "#94a3b8" : "#a78bfa",
                    fontWeight: 600,
                    minWidth: 60,
                  }}
                >
                  {label}
                </span>
                <span style={{ color: "#94a3b8" }}>→</span>
                <span style={{ fontFamily: "var(--sl-font-mono, monospace)", color: "#f1f5f9" }}>
                  {target === "end" ? <em style={{ color: "#94a3b8" }}>end</em> : target}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {transitions.length === 0 && (
        <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontStyle: "italic" }}>
          Terminal state — recipe ends here.
        </div>
      )}
    </div>
  );
}

function RecipeOverview({ recipe, definition }: { recipe: (typeof RECIPES)[number]; definition: RecipeDefinition }) {
  const stats = recipeStats(definition);
  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div
          style={{
            fontSize: "0.65rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#94a3b8",
            marginBottom: 6,
          }}
        >
          Recipe
        </div>
        <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>{recipe.label}</div>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "#cbd5e1", lineHeight: 1.55 }}>{recipe.description}</p>
      </div>

      <div>
        <div
          style={{
            fontSize: "0.65rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#94a3b8",
            marginBottom: 8,
          }}
        >
          Phases
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(["learn", "act", "report"] as const).map((phase) => {
            const { label, color } = PHASE_META[phase];
            const count = stats[phase];
            const pct = Math.round((count / stats.total) * 100);
            return (
              <div key={phase}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}
                >
                  <span style={{ fontSize: "0.72rem", fontWeight: 600, color }}>{label}</span>
                  <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{count}</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, opacity: 0.7 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 4, fontSize: "0.72rem", color: "#94a3b8", lineHeight: 1.5 }}>
        <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{stats.total} states</span> total. Click any node to inspect
        its phase, routing, and transitions.
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9" />
    </svg>
  );
}

function CompressIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 1v4H1M9 1v4h4M5 13V9H1M9 13V9h4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="5" y="5" width="8" height="8" rx="1" />
      <path d="M9 5V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3" />
    </svg>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOOLBAR_H = 48;
const FOOTER_H = 30;
const PANEL_WIDTH_DETAIL = 240;
const PANEL_WIDTH_OVERVIEW = 200;
const JSON_PANEL_W = 380;
const EMBEDDED_HEIGHT = "min(72vh, 760px)";

// ── Main component ────────────────────────────────────────────────────────────

export function RecipeExplorer() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(RECIPES[0].definition, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [liveDefinition, setLiveDefinition] = useState<RecipeDefinition>(RECIPES[0].definition);
  const [copied, setCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recipe = RECIPES[activeIdx];
  const selectedState = selectedStateId ? liveDefinition.states[selectedStateId] : null;

  function switchRecipe(idx: number) {
    setActiveIdx(idx);
    setSelectedStateId(null);
    setLiveDefinition(RECIPES[idx].definition);
    setJsonText(JSON.stringify(RECIPES[idx].definition, null, 2));
    setParseError(null);
  }

  const handleJsonChange = useCallback((text: string) => {
    setJsonText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        const parsed = JSON.parse(text) as RecipeDefinition;
        if (parsed && typeof parsed === "object" && typeof parsed.initial === "string" && parsed.states) {
          setLiveDefinition(parsed);
          setParseError(null);
          setSelectedStateId(null);
        } else {
          setParseError("Missing required fields: id, initial, states");
        }
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Invalid JSON");
      }
    }, 350);
  }, []);

  async function copyJson() {
    await navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function toggleFullscreen() {
    const next = !isFullscreen;
    setIsFullscreen(next);
    document.body.style.overflow = next ? "hidden" : "";
  }

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsFullscreen(false);
        document.body.style.overflow = "";
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // Restore scroll on unmount
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // ── Panes ──────────────────────────────────────────────────────────────────

  const bodyHeight = isFullscreen
    ? `calc(100vh - ${TOOLBAR_H + FOOTER_H}px)`
    : `calc(${EMBEDDED_HEIGHT} - ${TOOLBAR_H + FOOTER_H}px)`;

  const graphPane = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <RecipeViewer
        key={activeIdx}
        definition={liveDefinition}
        height={bodyHeight}
        onNodeClick={(id) => setSelectedStateId((prev) => (prev === id ? null : id))}
      />
    </div>
  );

  const jsonPane = (
    <div
      style={{
        width: viewMode === "source" ? "100%" : JSON_PANEL_W,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderLeft: viewMode === "split" ? "1px solid rgba(255,255,255,0.08)" : "none",
        background: "#020617",
      }}
    >
      {/* JSON pane header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.03)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "#475569",
          }}
        >
          RecipeDefinition · JSON
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {parseError ? (
            <span style={{ fontSize: 10, color: "#f87171" }}>⚠ invalid</span>
          ) : (
            <span style={{ fontSize: 10, color: "#22c55e" }}>✓ valid</span>
          )}
          <button
            onClick={copyJson}
            title="Copy JSON"
            style={{
              background: "none",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              cursor: "pointer",
              color: copied ? "#22c55e" : "#475569",
              padding: "2px 6px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
            }}
          >
            <CopyIcon />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Textarea */}
      <textarea
        value={jsonText}
        onChange={(e) => handleJsonChange(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        style={{
          flex: 1,
          width: "100%",
          background: "transparent",
          color: parseError ? "#fca5a5" : "#94a3b8",
          fontFamily: "'ui-monospace', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          fontSize: 12,
          lineHeight: 1.65,
          padding: "12px 14px",
          border: "none",
          outline: "none",
          resize: "none",
          boxSizing: "border-box",
          tabSize: 2,
          height: bodyHeight,
        }}
      />
    </div>
  );

  const sidePanel = viewMode === "visual" && (
    <div
      style={{
        width: selectedState ? PANEL_WIDTH_DETAIL : PANEL_WIDTH_OVERVIEW,
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
          isInitial={selectedStateId === liveDefinition.initial}
          onClose={() => setSelectedStateId(null)}
        />
      ) : (
        <RecipeOverview recipe={recipe} definition={liveDefinition} />
      )}
    </div>
  );

  // ── Toolbar ────────────────────────────────────────────────────────────────

  const toolbar = (
    <div
      style={{
        height: TOOLBAR_H,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 14px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        flexShrink: 0,
      }}
    >
      {/* Recipe tabs */}
      {RECIPES.map((r, i) => (
        <button
          key={r.id}
          onClick={() => switchRecipe(i)}
          style={{
            padding: "4px 14px",
            borderRadius: 6,
            border: "1px solid",
            cursor: "pointer",
            fontSize: "0.78rem",
            fontWeight: 600,
            background: activeIdx === i ? "#6366f1" : "transparent",
            color: activeIdx === i ? "#fff" : "#64748b",
            borderColor: activeIdx === i ? "#6366f1" : "rgba(255,255,255,0.1)",
          }}
        >
          {r.label}
        </button>
      ))}

      {/* Divider */}
      <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.1)", margin: "0 4px", flexShrink: 0 }} />

      {/* View mode segmented control */}
      <div
        style={{
          display: "flex",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {(
          [
            ["visual", "Visual"],
            ["split", "Split"],
            ["source", "Source"],
          ] as [ViewMode, string][]
        ).map(([mode, label], i) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              padding: "3px 11px",
              border: "none",
              borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.1)" : "none",
              cursor: "pointer",
              fontSize: "0.72rem",
              fontWeight: 500,
              background: viewMode === mode ? "rgba(99,102,241,0.2)" : "transparent",
              color: viewMode === mode ? "#a5b4fc" : "#475569",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Phase legend */}
      <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
        {(["learn", "act", "report"] as const).map((phase) => {
          const { label, color } = PHASE_META[phase];
          return (
            <div key={phase} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: color, opacity: 0.85, flexShrink: 0 }} />
              <span style={{ fontSize: "0.68rem", color: "#475569" }}>{label}</span>
            </div>
          );
        })}
      </div>

      {/* Fullscreen toggle */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        style={{
          marginLeft: 8,
          padding: "5px 7px",
          borderRadius: 5,
          border: "1px solid rgba(255,255,255,0.1)",
          cursor: "pointer",
          background: "transparent",
          color: "#475569",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
      </button>
    </div>
  );

  // ── Footer ─────────────────────────────────────────────────────────────────

  const footerHint =
    viewMode === "visual"
      ? "Scroll to zoom · drag to pan · click a node to inspect"
      : viewMode === "split"
        ? "Edit JSON to live-update the graph"
        : "Paste or type a RecipeDefinition JSON object";

  const footer = (
    <div
      style={{
        height: FOOTER_H,
        padding: "0 14px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        fontSize: "0.67rem",
        color: "#334155",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        gap: 8,
      }}
    >
      <span>{footerHint}</span>
      {parseError && viewMode !== "visual" && (
        <span
          style={{
            color: "#f87171",
            fontSize: "0.67rem",
            fontFamily: "monospace",
            maxWidth: 420,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 1,
          }}
        >
          ⚠ {parseError}
        </span>
      )}
      <a
        href="https://github.com/swenyai/sweny"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "inherit", textDecoration: "none", flexShrink: 0 }}
      >
        @sweny-ai/engine
      </a>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="recipe-explorer-root"
      style={
        isFullscreen
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              background: "#080d16",
              borderRadius: 0,
            }
          : {
              display: "flex",
              flexDirection: "column",
              height: EMBEDDED_HEIGHT,
              background: "#080d16",
              borderRadius: 0,
              overflow: "hidden",
            }
      }
    >
      {toolbar}

      {/* Body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {viewMode !== "source" && graphPane}
        {viewMode !== "visual" && jsonPane}
        {viewMode === "visual" && sidePanel}
      </div>

      {footer}
    </div>
  );
}
