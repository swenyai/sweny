import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { WorkflowViewer } from "@sweny-ai/studio/viewer";
import { triageWorkflow, implementWorkflow } from "@sweny-ai/core/workflows";
import { builtinSkills } from "@sweny-ai/core/browser";
import "@sweny-ai/studio/style.css";
import type { Workflow, Node, Skill } from "@sweny-ai/core/browser";
import {
  usedSkillIds,
  nodesUsingSkill,
  collectSkillEnvVars,
  generateEnvTemplate,
  generateCodeSnippet,
} from "../lib/workflow-helpers";

// ── Skill catalog (from core, browser-safe — includes config for env vars) ───

const SKILL_MAP = new Map<string, Skill>(builtinSkills.map((s) => [s.id, s]));

// Skill accent colors — consistent with Studio node rendering
const SKILL_COLORS: Record<string, string> = {
  github: "#8b5cf6",
  linear: "#5E6AD2",
  sentry: "#362D59",
  datadog: "#632CA6",
  slack: "#4A154B",
  notification: "#10b981",
};

function skillColor(id: string): string {
  return SKILL_COLORS[id] ?? "#6366f1";
}

// ── Workflow data ─────────────────────────────────────────────────────────────

const WORKFLOWS: { id: string; label: string; description: string; workflow: Workflow }[] = [
  {
    id: "triage",
    label: "Triage",
    description: "Investigate a production alert, determine root cause, create an issue, and notify the team.",
    workflow: triageWorkflow,
  },
  {
    id: "implement",
    label: "Implement",
    description: "Analyze an issue, implement a fix, open a pull request, and notify the team.",
    workflow: implementWorkflow,
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = "visual" | "skills" | "split" | "source";

// ── Sub-components ────────────────────────────────────────────────────────────

function SkillBadge({ skillId, size = "sm" }: { skillId: string; size?: "sm" | "md" }) {
  const catalog = SKILL_MAP.get(skillId);
  const name = catalog?.name ?? skillId;
  const color = skillColor(skillId);
  const isSm = size === "sm";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: isSm ? "1px 6px" : "2px 8px",
        borderRadius: 5,
        fontSize: isSm ? "0.65rem" : "0.72rem",
        fontWeight: 600,
        color,
        background: color + "18",
        border: `1px solid ${color}33`,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {name}
    </span>
  );
}

function NodeDetail({
  nodeId,
  node,
  workflow,
  isEntry,
  isTerminal,
  onClose,
}: {
  nodeId: string;
  node: Node;
  workflow: Workflow;
  isEntry: boolean;
  isTerminal: boolean;
  onClose: () => void;
}) {
  const outEdges = workflow.edges.filter((e) => e.from === nodeId);
  const inEdges = workflow.edges.filter((e) => e.to === nodeId);
  const catalog = node.skills.map((sid) => SKILL_MAP.get(sid)).filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
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
            {isEntry && (
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
                ENTRY
              </span>
            )}
            {isTerminal && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  color: "#10b981",
                  background: "rgba(16,185,129,0.1)",
                  border: "1px solid rgba(16,185,129,0.2)",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                TERMINAL
              </span>
            )}
          </div>
          <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f1f5f9", marginBottom: 2 }}>{node.name}</div>
          <div
            style={{
              fontFamily: "var(--sl-font-mono, monospace)",
              fontSize: "0.72rem",
              color: "#64748b",
            }}
          >
            {nodeId}
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
          &times;
        </button>
      </div>

      {/* Instruction */}
      <div>
        <div style={sectionLabel}>Instruction</div>
        <div
          style={{
            fontSize: "0.78rem",
            color: "#cbd5e1",
            lineHeight: 1.6,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 6,
            padding: "8px 10px",
            whiteSpace: "pre-wrap",
            maxHeight: 180,
            overflowY: "auto",
          }}
        >
          {node.instruction || <em style={{ color: "#475569" }}>No instruction set.</em>}
        </div>
      </div>

      {/* Skills */}
      {node.skills.length > 0 && (
        <div>
          <div style={sectionLabel}>Skills</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {catalog.map(
              (skill) =>
                skill && (
                  <div
                    key={skill.id}
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: 6,
                      padding: "6px 8px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <SkillBadge skillId={skill.id} />
                      <span style={{ fontSize: "0.65rem", color: "#475569", marginLeft: "auto" }}>
                        {skill.tools.length} tool{skill.tools.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
                      {skill.tools.map((t) => (
                        <span
                          key={t.name}
                          style={{
                            fontSize: "0.62rem",
                            fontFamily: "var(--sl-font-mono, monospace)",
                            color: "#475569",
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            borderRadius: 3,
                            padding: "1px 5px",
                          }}
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ),
            )}
          </div>
        </div>
      )}

      {/* Edges */}
      {(inEdges.length > 0 || outEdges.length > 0) && (
        <div>
          <div style={sectionLabel}>Edges</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {inEdges.map((edge) => (
              <EdgeChip key={`in-${edge.from}`} direction="in" otherNode={edge.from} when={edge.when} />
            ))}
            {outEdges.map((edge) => (
              <EdgeChip key={`out-${edge.to}`} direction="out" otherNode={edge.to} when={edge.when} />
            ))}
          </div>
        </div>
      )}

      {isTerminal && outEdges.length === 0 && (
        <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontStyle: "italic" }}>
          Terminal node — workflow ends here.
        </div>
      )}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: "0.65rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#94a3b8",
  marginBottom: 6,
};

function EdgeChip({ direction, otherNode, when }: { direction: "in" | "out"; otherNode: string; when?: string }) {
  const isConditional = !!when;
  return (
    <div
      style={{
        fontSize: "0.75rem",
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${isConditional ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: 6,
        padding: "5px 8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: "0.65rem", color: direction === "in" ? "#60a5fa" : "#a78bfa", fontWeight: 600 }}>
          {direction === "in" ? "from" : "to"}
        </span>
        <span style={{ fontFamily: "var(--sl-font-mono, monospace)", color: "#f1f5f9", fontWeight: 600 }}>
          {otherNode}
        </span>
      </div>
      {when && (
        <div
          style={{
            marginTop: 3,
            fontSize: "0.68rem",
            color: "#f59e0b",
            fontStyle: "italic",
            lineHeight: 1.4,
          }}
        >
          when: {when}
        </div>
      )}
    </div>
  );
}

function WorkflowOverview({ workflow, wf }: { workflow: (typeof WORKFLOWS)[number]; wf: Workflow }) {
  const nodeIds = Object.keys(wf.nodes);
  const skillIds = usedSkillIds(wf);
  const conditionalEdges = wf.edges.filter((e) => e.when);

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={sectionLabel}>Workflow</div>
        <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>{workflow.label}</div>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "#cbd5e1", lineHeight: 1.55 }}>{workflow.description}</p>
      </div>

      {/* Stats */}
      <div>
        <div style={sectionLabel}>Structure</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <StatRow label="Nodes" value={nodeIds.length} color="#6366f1" />
          <StatRow label="Edges" value={wf.edges.length} color="#60a5fa" />
          <StatRow label="Conditional" value={conditionalEdges.length} color="#f59e0b" />
          <StatRow label="Skills" value={skillIds.length} color="#10b981" />
        </div>
      </div>

      {/* Skills used */}
      <div>
        <div style={sectionLabel}>Skills Used</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {skillIds.map((sid) => (
            <SkillBadge key={sid} skillId={sid} size="md" />
          ))}
        </div>
      </div>

      {/* How to use */}
      <div
        style={{
          fontSize: "0.72rem",
          color: "#64748b",
          lineHeight: 1.6,
          padding: "10px 12px",
          borderRadius: 7,
          background: "rgba(99,102,241,0.07)",
          border: "1px solid rgba(99,102,241,0.15)",
          marginTop: 4,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            color: "#a5b4fc",
            marginBottom: 3,
            fontSize: "0.7rem",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          How to use
        </div>
        <span style={{ color: "#94a3b8" }}>{nodeIds.length} nodes</span> connected by{" "}
        <span style={{ color: "#94a3b8" }}>{wf.edges.length} edges</span>
        {conditionalEdges.length > 0 && (
          <>
            {" "}
            (<span style={{ color: "#f59e0b" }}>{conditionalEdges.length} conditional</span>)
          </>
        )}
        <br />
        Scroll to zoom &middot; drag to pan
        <br />
        <span style={{ color: "#6366f1", fontWeight: 600 }}>Click any node</span> to see its instruction, skills, and
        edges.
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: "0.72rem", fontWeight: 600, color }}>{label}</span>
      <span
        style={{ fontSize: "0.8rem", fontWeight: 700, color: "#f1f5f9", fontFamily: "var(--sl-font-mono, monospace)" }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Skills Panel ──────────────────────────────────────────────────────────────

function SkillsPanel({ workflow }: { workflow: Workflow }) {
  const [outputTab, setOutputTab] = useState<"env" | "code">("env");
  const [copied, setCopied] = useState(false);

  const skillIds = usedSkillIds(workflow);
  const envVars = collectSkillEnvVars(workflow, SKILL_MAP);
  const requiredCount = envVars.filter((v) => v.required).length;

  const envText = generateEnvTemplate(workflow, SKILL_MAP);
  const codeText = generateCodeSnippet(workflow);
  const outputText = outputTab === "env" ? envText : codeText;

  async function copyOutput() {
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "#3d4f6a",
            }}
          >
            Skills Setup
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>
            {skillIds.length} skill{skillIds.length !== 1 ? "s" : ""} &middot; {requiredCount} env var
            {requiredCount !== 1 ? "s" : ""}
          </span>
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 10.5, color: "#2d3f58", lineHeight: 1.5 }}>
          Each skill provides Claude with tools at specific nodes. Configure env vars to enable them.
        </p>
      </div>

      {/* Skill cards */}
      <div
        style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}
      >
        {skillIds.map((sid) => {
          const catalog = SKILL_MAP.get(sid);
          if (!catalog) return null;
          const nodes = nodesUsingSkill(workflow, sid);
          const color = skillColor(sid);
          const envs = Object.entries(catalog.config).map(([key, field]) => ({
            key,
            description: field.description,
            required: field.required ?? false,
          }));

          return (
            <div
              key={sid}
              style={{
                borderRadius: 9,
                border: `1px solid ${color}44`,
                background: color + "0a",
              }}
            >
              {/* Card header */}
              <div style={{ padding: "9px 12px 7px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#c8d8e8" }}>{catalog.name}</span>
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.05)",
                      color: "#3d4f6a",
                    }}
                  >
                    {catalog.tools.length} tool{catalog.tools.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 10.5, color: "#475569", lineHeight: 1.4 }}>{catalog.description}</p>
                {/* Node chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 5 }}>
                  <span style={{ fontSize: 9, color: "#475569", fontWeight: 600, marginRight: 2 }}>Used by:</span>
                  {nodes.map((id) => (
                    <span
                      key={id}
                      style={{
                        fontSize: 9.5,
                        fontFamily: "monospace",
                        color: "#94a3b8",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      {id}
                    </span>
                  ))}
                </div>
              </div>

              {/* Env vars */}
              {envs.length > 0 && (
                <div style={{ padding: "8px 12px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
                  {envs.map((ev) => (
                    <div
                      key={ev.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 6px",
                        borderRadius: 5,
                        background: "rgba(255,255,255,0.03)",
                        fontSize: 10.5,
                      }}
                    >
                      <code
                        style={{ color: ev.required ? "#93c5fd" : "#3d4f6a", fontFamily: "monospace", flexShrink: 0 }}
                      >
                        {ev.key}
                      </code>
                      <span
                        style={{
                          color: "#2d3f58",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ev.description}
                      </span>
                      <span
                        style={{
                          fontSize: 8.5,
                          fontWeight: 700,
                          padding: "1px 4px",
                          borderRadius: 3,
                          background: ev.required ? "rgba(239,68,68,0.15)" : "rgba(100,116,139,0.1)",
                          color: ev.required ? "#fca5a5" : "#3d4f6a",
                          flexShrink: 0,
                        }}
                      >
                        {ev.required ? "req" : "opt"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Output section */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "5px 10px 0", gap: 2 }}>
          {(["env", "code"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setOutputTab(tab)}
              style={{
                padding: "3px 10px",
                border: "none",
                borderBottom: `2px solid ${outputTab === tab ? "#6366f1" : "transparent"}`,
                background: "transparent",
                cursor: "pointer",
                fontSize: 10.5,
                fontWeight: 600,
                color: outputTab === tab ? "#a5b4fc" : "#3d4f6a",
              }}
            >
              {tab === "env" ? ".env template" : "TypeScript setup"}
            </button>
          ))}
          <button
            onClick={copyOutput}
            style={{
              marginLeft: "auto",
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent",
              cursor: "pointer",
              fontSize: 9.5,
              color: copied ? "#22c55e" : "#3d4f6a",
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: "10px 12px",
            fontSize: 10.5,
            fontFamily: "monospace",
            color: "#4a6180",
            lineHeight: 1.7,
            overflowX: "auto",
            maxHeight: 175,
            overflowY: "auto",
            background: "#020814",
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          {outputText}
        </pre>
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

// ── Layout constants ──────────────────────────────────────────────────────────

const TOOLBAR_H = 52;
const FOOTER_H = 30;
const PANEL_W_DETAIL = 260;
const PANEL_W_OVERVIEW = 210;
const JSON_PANEL_W = 380;
const SKILLS_PANEL_W = 380;
const EMBEDDED_HEIGHT = "min(80vh, 800px)";

// ── Main component ────────────────────────────────────────────────────────────

export function WorkflowExplorer() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(WORKFLOWS[0].workflow, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [liveWorkflow, setLiveWorkflow] = useState<Workflow>(WORKFLOWS[0].workflow);
  const [copied, setCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workflowEntry = WORKFLOWS[activeIdx];
  const selectedNode = selectedNodeId ? liveWorkflow.nodes[selectedNodeId] : null;

  const terminalIds = useMemo(() => {
    const hasOutgoing = new Set(liveWorkflow.edges.map((e) => e.from));
    return new Set(Object.keys(liveWorkflow.nodes).filter((id) => !hasOutgoing.has(id)));
  }, [liveWorkflow]);

  function switchWorkflow(idx: number) {
    setActiveIdx(idx);
    setSelectedNodeId(null);
    setLiveWorkflow(WORKFLOWS[idx].workflow);
    setJsonText(JSON.stringify(WORKFLOWS[idx].workflow, null, 2));
    setParseError(null);
  }

  const handleJsonChange = useCallback((text: string) => {
    setJsonText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        const parsed = JSON.parse(text) as Workflow;
        if (parsed && typeof parsed.entry === "string" && parsed.nodes && typeof parsed.id === "string") {
          setLiveWorkflow(parsed);
          setParseError(null);
          setSelectedNodeId(null);
        } else {
          setParseError("Missing required fields: id, entry, nodes");
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

  useEffect(
    () => () => {
      document.body.style.overflow = "";
    },
    [],
  );

  // ── Body layout ────────────────────────────────────────────────────────────

  const bodyHeight = isFullscreen
    ? `calc(100vh - ${TOOLBAR_H + FOOTER_H}px)`
    : `calc(${EMBEDDED_HEIGHT} - ${TOOLBAR_H + FOOTER_H}px)`;

  const graphPane = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <WorkflowViewer
        key={activeIdx}
        workflow={liveWorkflow}
        height={bodyHeight}
        onNodeClick={(id) => setSelectedNodeId((prev) => (prev === id ? null : id))}
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
        <div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "#3d4f6a",
            }}
          >
            Workflow
          </span>
          {viewMode === "source" && (
            <span style={{ fontSize: 10, color: "#2d3f58", marginLeft: 8 }}>
              Edit the JSON below — the graph updates live
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {parseError ? (
            <span style={{ fontSize: 10, color: "#f87171" }}>invalid</span>
          ) : (
            <span style={{ fontSize: 10, color: "#22c55e" }}>valid</span>
          )}
          <button
            onClick={copyJson}
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
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 1.65,
          padding: "12px 14px",
          border: "none",
          outline: "none",
          resize: "none",
          boxSizing: "border-box",
          height: bodyHeight,
        }}
      />
    </div>
  );

  const visualSidePanel = viewMode === "visual" && (
    <div
      style={{
        width: selectedNode ? PANEL_W_DETAIL : PANEL_W_OVERVIEW,
        flexShrink: 0,
        borderLeft: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(4,8,18,0.5)",
        overflowY: "auto",
        transition: "width 0.2s ease",
      }}
    >
      {selectedNode ? (
        <NodeDetail
          nodeId={selectedNodeId!}
          node={selectedNode}
          workflow={liveWorkflow}
          isEntry={selectedNodeId === liveWorkflow.entry}
          isTerminal={terminalIds.has(selectedNodeId!)}
          onClose={() => setSelectedNodeId(null)}
        />
      ) : (
        <WorkflowOverview workflow={workflowEntry} wf={liveWorkflow} />
      )}
    </div>
  );

  const skillsPanel = viewMode === "skills" && (
    <div
      style={{
        width: SKILLS_PANEL_W,
        flexShrink: 0,
        borderLeft: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(4,8,18,0.5)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SkillsPanel workflow={liveWorkflow} />
    </div>
  );

  // ── Toolbar ────────────────────────────────────────────────────────────────

  const MODES: [ViewMode, string][] = [
    ["visual", "Visual"],
    ["skills", "Skills"],
    ["split", "Split"],
    ["source", "JSON"],
  ];

  const skillIds = usedSkillIds(liveWorkflow);

  const toolbar = (
    <div
      style={{
        height: TOOLBAR_H,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px 0 14px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "linear-gradient(180deg, rgba(12,20,40,0.98) 0%, rgba(8,13,22,0.98) 100%)",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {/* Brand mark */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginRight: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 15, color: "#6366f1", lineHeight: 1 }}>&#x2B21;</span>
        <span
          style={{
            fontSize: "0.72rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#4f5f80",
          }}
        >
          sweny
        </span>
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

      {/* Workflow selector */}
      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
        {WORKFLOWS.map((r, i) => (
          <button
            key={r.id}
            onClick={() => switchWorkflow(i)}
            style={{
              padding: "4px 14px",
              borderRadius: 6,
              border: "1px solid",
              cursor: "pointer",
              fontSize: "0.77rem",
              fontWeight: 600,
              letterSpacing: "0.01em",
              background: activeIdx === i ? "rgba(99,102,241,0.22)" : "transparent",
              color: activeIdx === i ? "#c7d2fe" : "#4f5f80",
              borderColor: activeIdx === i ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.07)",
              transition: "all 0.12s ease",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

      {/* View mode tabs */}
      <div
        style={{
          display: "flex",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 7,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {MODES.map(([mode, label], i) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              padding: "3px 13px",
              border: "none",
              borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.07)" : "none",
              cursor: "pointer",
              fontSize: "0.71rem",
              fontWeight: 600,
              letterSpacing: "0.02em",
              background: viewMode === mode ? "rgba(99,102,241,0.25)" : "transparent",
              color: viewMode === mode ? "#a5b4fc" : "#3d4f6a",
              transition: "all 0.12s ease",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Skill legend — pushed right */}
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        {skillIds.slice(0, 5).map((sid) => {
          const color = skillColor(sid);
          const name = SKILL_MAP.get(sid)?.name ?? sid;
          return (
            <div key={sid} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: color, opacity: 0.75, flexShrink: 0 }} />
              <span style={{ fontSize: "0.67rem", fontWeight: 500, color: "#3d4f6a", letterSpacing: "0.02em" }}>
                {name}
              </span>
            </div>
          );
        })}
        {skillIds.length > 5 && <span style={{ fontSize: "0.65rem", color: "#3d4f6a" }}>+{skillIds.length - 5}</span>}
      </div>

      {/* Fullscreen toggle */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        style={{
          marginLeft: 6,
          padding: "5px 7px",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.08)",
          cursor: "pointer",
          background: "transparent",
          color: "#3d4f6a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
      </button>
    </div>
  );

  // ── Footer ─────────────────────────────────────────────────────────────────

  const footerHint =
    viewMode === "visual"
      ? "Scroll to zoom  \u00b7  drag to pan  \u00b7  click a node to inspect"
      : viewMode === "skills"
        ? "Configure skills and copy env vars or setup code"
        : viewMode === "split"
          ? "Edit JSON on the right to live-update the graph"
          : "Paste or type a Workflow JSON to visualize it";

  const footer = (
    <div
      style={{
        height: FOOTER_H,
        padding: "0 14px",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(4,8,18,0.6)",
        fontSize: "0.65rem",
        color: "#2d3f58",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        gap: 8,
        letterSpacing: "0.01em",
      }}
    >
      <span>{footerHint}</span>
      {parseError && viewMode !== "visual" && viewMode !== "skills" && (
        <span
          style={{
            color: "#f87171",
            fontSize: "0.65rem",
            fontFamily: "monospace",
            maxWidth: 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 1,
          }}
        >
          {parseError}
        </span>
      )}
      <span style={{ flexShrink: 0, opacity: 0.6 }}>@sweny-ai/core</span>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="workflow-explorer-root"
      style={
        isFullscreen
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              background: "#060c18",
              borderRadius: 0,
            }
          : {
              display: "flex",
              flexDirection: "column",
              height: EMBEDDED_HEIGHT,
              background: "#060c18",
              borderRadius: 0,
              overflow: "hidden",
            }
      }
    >
      {toolbar}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {viewMode !== "source" && graphPane}
        {viewMode === "split" && jsonPane}
        {viewMode === "source" && jsonPane}
        {viewMode === "visual" && visualSidePanel}
        {viewMode === "skills" && skillsPanel}
      </div>
      {footer}
    </div>
  );
}
