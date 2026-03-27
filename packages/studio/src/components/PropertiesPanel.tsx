import { useState, useMemo } from "react";
import type { Node, NodeResult } from "@sweny-ai/core";
import { validateWorkflow } from "@sweny-ai/core/schema";
import { getSkillCatalog } from "@sweny-ai/core/studio";
import { useEditorStore } from "../store/editor-store.js";
import { SkillIcon } from "./SkillIcon.js";

const skillCatalog = getSkillCatalog();

export function PropertiesPanel() {
  const {
    workflow,
    selection,
    setSelection,
    updateNode,
    updateWorkflowMeta,
    deleteNode,
    renameNode,
    setEntry,
    updateEdge,
    deleteEdge,
    mode,
    completedNodes,
    currentNodeId,
  } = useEditorStore();

  const readOnly = mode !== "design";

  const nodeIds = Object.keys(workflow.nodes);
  const unreachableIds = useMemo(
    () =>
      new Set(
        validateWorkflow(workflow)
          .filter((e) => e.code === "UNREACHABLE_NODE" && e.nodeId)
          .map((e) => e.nodeId!),
      ),
    [workflow],
  );

  if (selection?.kind === "node") {
    const { id } = selection;
    const node = workflow.nodes[id];
    if (!node) return <EmptyPanel />;
    const execResult = completedNodes[id] as NodeResult | undefined;
    const isRunning = id === currentNodeId;
    const isUnreachable = unreachableIds.has(id);
    return (
      <NodePanel
        key={id}
        id={id}
        node={node}
        nodeIds={nodeIds}
        isEntry={workflow.entry === id}
        isUnreachable={isUnreachable}
        readOnly={readOnly}
        execResult={execResult}
        isRunning={isRunning}
        updateNode={updateNode}
        renameNode={renameNode}
        setEntry={setEntry}
        deleteNode={(nid) => {
          if (window.confirm(`Delete node "${nid}"?`)) {
            deleteNode(nid);
          }
        }}
      />
    );
  }

  if (selection?.kind === "edge") {
    const { id: edgeId, from, to } = selection;
    const edge = workflow.edges.find((e) => `${e.from}--${e.to}` === edgeId);
    return (
      <EdgePanel
        key={edgeId}
        edgeId={edgeId}
        from={from}
        to={to}
        when={edge?.when ?? ""}
        nodeIds={nodeIds}
        readOnly={readOnly}
        updateEdge={updateEdge}
        deleteEdge={(eid) => {
          deleteEdge(eid);
          setSelection(null);
        }}
      />
    );
  }

  // Nothing selected — workflow meta
  return <WorkflowMetaPanel />;
}

// ─────────────────────────────────────────────
// Workflow meta panel
// ─────────────────────────────────────────────

function WorkflowMetaPanel() {
  const { workflow, updateWorkflowMeta, setEntry, mode } = useEditorStore();
  const readOnly = mode !== "design";
  const [name, setName] = useState(workflow.name ?? "");
  const [description, setDescription] = useState(workflow.description ?? "");
  const nodeIds = Object.keys(workflow.nodes);

  return (
    <div className="w-96 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4">
      <h2 className="font-semibold text-gray-800 mb-3 text-sm">Workflow</h2>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">ID</label>
        <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded block">{workflow.id}</code>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => updateWorkflowMeta({ name })}
          disabled={readOnly}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <textarea
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm resize-none ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => updateWorkflowMeta({ description })}
          disabled={readOnly}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Entry node</label>
        <select
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={workflow.entry}
          onChange={(e) => setEntry(e.target.value)}
          disabled={readOnly}
        >
          {nodeIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        {readOnly ? "Read-only during execution." : "Click a node or edge to edit it."}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Node panel
// ─────────────────────────────────────────────

interface NodePanelProps {
  id: string;
  node: Node;
  nodeIds: string[];
  isEntry: boolean;
  isUnreachable: boolean;
  readOnly: boolean;
  execResult?: NodeResult;
  isRunning: boolean;
  updateNode: (id: string, patch: Partial<Node>) => void;
  renameNode: (oldId: string, newId: string) => string | null;
  setEntry: (id: string) => void;
  deleteNode: (id: string) => void;
}

function NodePanel({
  id,
  node,
  nodeIds,
  isEntry,
  isUnreachable,
  readOnly,
  execResult,
  isRunning,
  updateNode,
  renameNode,
  setEntry,
  deleteNode,
}: NodePanelProps) {
  const [editId, setEditId] = useState(id);
  const [idError, setIdError] = useState<string | null>(null);
  const [name, setNodeName] = useState(node.name);
  const [instruction, setInstruction] = useState(node.instruction);

  return (
    <div className="w-96 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4">
      <h2 className="font-semibold text-gray-800 mb-3 text-sm">Node</h2>

      {/* Unreachable warning */}
      {isUnreachable && !readOnly && (
        <div className="bg-orange-50 border border-orange-200 rounded p-2 text-xs text-orange-700 mb-2">
          This node is unreachable from the entry node. Add an edge pointing to it.
        </div>
      )}

      {/* Execution result card */}
      {readOnly && <ExecutionResultCard result={execResult} isRunning={isRunning} />}

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">ID</label>
        <input
          className={`w-full border rounded px-2 py-1 text-sm font-mono ${idError ? "border-red-400" : "border-gray-300"} ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={editId}
          disabled={readOnly}
          onChange={(e) => {
            setEditId(e.target.value);
            setIdError(null);
          }}
          onBlur={() => {
            const trimmed = editId.trim();
            if (trimmed === id) return;
            const err = renameNode(id, trimmed);
            if (err) {
              setIdError(err);
              setEditId(id);
            } else {
              setIdError(null);
            }
          }}
        />
        {idError && <p className="text-xs text-red-500 mt-0.5">{idError}</p>}
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={name}
          disabled={readOnly}
          onChange={(e) => setNodeName(e.target.value)}
          onBlur={() => updateNode(id, { name })}
        />
      </div>

      <div className="mb-3 flex-1 flex flex-col min-h-0">
        <label className="block text-xs font-medium text-gray-600 mb-1">Instruction</label>
        <textarea
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm resize-y font-mono flex-1 ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          rows={14}
          value={instruction}
          disabled={readOnly}
          onChange={(e) => setInstruction(e.target.value)}
          onBlur={() => updateNode(id, { instruction })}
          placeholder="What should Claude do at this node?"
        />
      </div>

      {/* Skills toggle list */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-2">Skills</label>
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          {skillCatalog.map((skill) => {
            const active = node.skills.includes(skill.id);
            return (
              <label
                key={skill.id}
                className={`flex items-center gap-2 text-xs p-1.5 rounded ${active ? "bg-blue-50" : "hover:bg-gray-50"} ${readOnly ? "opacity-60" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  disabled={readOnly}
                  onChange={() => {
                    const newSkills = active ? node.skills.filter((s) => s !== skill.id) : [...node.skills, skill.id];
                    updateNode(id, { skills: newSkills });
                  }}
                />
                <SkillIcon skillId={skill.id} size={14} />
                <span className="font-medium text-gray-700">{skill.name}</span>
                <span className="text-gray-400 ml-auto">{skill.tools.length} tools</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col gap-2">
          <button
            onClick={() => setEntry(id)}
            disabled={isEntry}
            className="px-3 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isEntry ? "Entry node" : "Set as entry"}
          </button>
          <button
            onClick={() => deleteNode(id)}
            className="px-3 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-500"
          >
            Delete node
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Execution result card
// ─────────────────────────────────────────────

interface ExecutionResultCardProps {
  result?: NodeResult;
  isRunning: boolean;
}

function ExecutionResultCard({ result, isRunning }: ExecutionResultCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (isRunning) {
    return (
      <div className="mb-3 p-2 rounded bg-blue-50 border border-blue-200 text-xs animate-pulse">
        <span className="text-blue-600 font-medium">running...</span>
      </div>
    );
  }

  if (!result) {
    return <div className="mb-3 p-2 rounded bg-gray-50 border border-gray-200 text-xs text-gray-400">pending</div>;
  }

  const statusColor =
    result.status === "success"
      ? "text-green-700 bg-green-50 border-green-200"
      : result.status === "failed"
        ? "text-red-700 bg-red-50 border-red-200"
        : "text-gray-600 bg-gray-50 border-gray-200";

  const icon = result.status === "success" ? "ok" : result.status === "failed" ? "fail" : "skip";
  const hasData = Object.keys(result.data ?? {}).length > 0;
  const dataJson = hasData ? JSON.stringify(result.data, null, 2) : null;

  return (
    <div className={`mb-3 p-2 rounded border text-xs ${statusColor}`}>
      <div className="flex items-center gap-1.5 font-medium">
        <span>{icon}</span>
        <span>{result.status}</span>
      </div>
      {result.toolCalls.length > 0 && (
        <p className="mt-1 text-[10px] opacity-80">{result.toolCalls.length} tool calls</p>
      )}
      {hasData && (
        <div className="mt-1">
          <button onClick={() => setExpanded((v) => !v)} className="text-[10px] underline opacity-70 hover:opacity-100">
            {expanded ? "Hide data" : "Show data"}
          </button>
          {expanded && (
            <pre className="mt-1 text-[10px] bg-white/60 rounded p-1 overflow-auto max-h-32 whitespace-pre-wrap">
              {dataJson!.length > 800 ? dataJson!.slice(0, 800) + "..." : dataJson}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Edge panel
// ─────────────────────────────────────────────

interface EdgePanelProps {
  edgeId: string;
  from: string;
  to: string;
  when: string;
  nodeIds: string[];
  readOnly: boolean;
  updateEdge: (edgeId: string, patch: { when?: string; to?: string }) => void;
  deleteEdge: (edgeId: string) => void;
}

function EdgePanel({ edgeId, from, to, when, nodeIds, readOnly, updateEdge, deleteEdge }: EdgePanelProps) {
  const [editWhen, setEditWhen] = useState(when);

  return (
    <div className="w-96 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4">
      <h2 className="font-semibold text-gray-800 mb-3 text-sm">Edge</h2>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
        <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded block">{from}</code>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
        <select
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          value={to}
          onChange={(e) => updateEdge(edgeId, { to: e.target.value })}
          disabled={readOnly}
        >
          {nodeIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Condition (when)</label>
        <textarea
          className={`w-full border border-gray-300 rounded px-2 py-1 text-sm resize-none ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
          rows={3}
          value={editWhen}
          onChange={(e) => setEditWhen(e.target.value)}
          onBlur={() => updateEdge(edgeId, { when: editWhen })}
          disabled={readOnly}
          placeholder="Leave empty for unconditional edge"
        />
        <p className="text-xs text-gray-400 mt-1">Natural language condition — Claude evaluates at runtime</p>
      </div>

      {!readOnly && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={() => deleteEdge(edgeId)}
            className="w-full px-3 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-500"
          >
            Delete edge
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Empty panel
// ─────────────────────────────────────────────

function EmptyPanel() {
  return (
    <div className="w-96 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4">
      <p className="text-xs text-gray-400">Node not found.</p>
    </div>
  );
}
