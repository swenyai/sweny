import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editor-store.js";

export interface ContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const { workflow, deleteNode, duplicateNode, disconnectNode, setEntry, setSelection } = useEditorStore();
  const ref = useRef<HTMLDivElement>(null);

  const node = workflow.nodes[menu.nodeId];
  const isEntry = workflow.entry === menu.nodeId;
  const hasEdges = workflow.edges.some((e) => e.from === menu.nodeId || e.to === menu.nodeId);

  // Close on outside click or escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  if (!node) return null;

  const items: { label: string; shortcut?: string; danger?: boolean; disabled?: boolean; action: () => void }[] = [
    {
      label: "Duplicate",
      shortcut: "D",
      action: () => {
        const newId = duplicateNode(menu.nodeId);
        if (newId) setSelection({ kind: "node", id: newId });
        onClose();
      },
    },
    {
      label: isEntry ? "Entry node" : "Set as entry",
      disabled: isEntry,
      action: () => {
        if (!isEntry) setEntry(menu.nodeId);
        onClose();
      },
    },
    {
      label: "Disconnect all edges",
      disabled: !hasEdges,
      action: () => {
        disconnectNode(menu.nodeId);
        onClose();
      },
    },
    {
      label: "Delete",
      shortcut: "Del",
      danger: true,
      action: () => {
        deleteNode(menu.nodeId);
        onClose();
      },
    },
  ];

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 1000 }}
      className="bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px] text-sm"
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider truncate">
        {node.name || menu.nodeId}
      </div>
      <div className="border-t border-gray-100 my-0.5" />
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.action}
          disabled={item.disabled}
          className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-4
            ${item.disabled ? "text-gray-300 cursor-not-allowed" : item.danger ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"}
          `}
        >
          <span className="text-xs">{item.label}</span>
          {item.shortcut && <span className="text-[10px] text-gray-400">{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}
