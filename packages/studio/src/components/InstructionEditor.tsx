import { useState, useEffect, useRef } from "react";

interface InstructionEditorProps {
  nodeId: string;
  nodeName: string;
  instruction: string;
  onSave: (instruction: string) => void;
  onClose: () => void;
}

export function InstructionEditor({ nodeId, nodeName, instruction, onSave, onClose }: InstructionEditorProps) {
  const [text, setText] = useState(instruction);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onSave(text);
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [text, onSave, onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-8" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl flex flex-col w-full max-w-3xl max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">{nodeName || nodeId}</h2>
            <p className="text-[10px] text-gray-400 font-mono">{nodeId}</p>
          </div>
          <div className="text-[10px] text-gray-400">
            <kbd className="px-1 py-0.5 bg-gray-100 rounded text-[9px]">Cmd+Enter</kbd> to save
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 p-5 min-h-0">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-full border border-gray-200 rounded-md px-4 py-3 text-sm font-mono resize-none focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
            placeholder="What should Claude do at this node? Be specific about what to query, how to interpret results, what output to produce, and how to handle edge cases."
            style={{ minHeight: 300 }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-gray-600 hover:text-gray-800 rounded">
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(text);
              onClose();
            }}
            className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
