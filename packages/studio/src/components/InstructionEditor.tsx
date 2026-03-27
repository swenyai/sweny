import { useState, useEffect, useRef } from "react";
import { generateInstruction } from "../lib/generate-instruction.js";
import { useEditorStore } from "../store/editor-store.js";

interface InstructionEditorProps {
  nodeId: string;
  nodeName: string;
  instruction: string;
  skills: string[];
  onSave: (instruction: string) => void;
  onClose: () => void;
}

const AI_ACTIONS = [
  { label: "Generate", icon: "sparkle", description: "Write from scratch based on node context" },
  { label: "Improve", icon: "sparkle", description: "Make more detailed and specific" },
  { label: "Add error handling", icon: "shield", description: "Add edge case and error handling" },
  { label: "Add output format", icon: "doc", description: "Define structured output expectations" },
] as const;

export function InstructionEditor({ nodeId, nodeName, instruction, skills, onSave, onClose }: InstructionEditorProps) {
  const [text, setText] = useState(instruction);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
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

  async function handleAiAction(action: (typeof AI_ACTIONS)[number]) {
    setAiLoading(true);
    setAiError(null);

    // Build the existing instruction with action-specific hints
    let existingInstruction = text;
    if (action.label === "Add error handling" && text.trim()) {
      existingInstruction = `${text}\n\n[Enhance this instruction with detailed error handling, edge cases, fallbacks, and what to do when data is missing or ambiguous]`;
    } else if (action.label === "Add output format" && text.trim()) {
      existingInstruction = `${text}\n\n[Enhance this instruction with a specific structured output format — define what fields to produce, data types, and how downstream nodes will consume the output]`;
    }

    try {
      const { workflow } = useEditorStore.getState();
      const result = await generateInstruction({
        nodeName,
        nodeId,
        skills,
        existingInstruction,
        workflowContext: {
          workflowName: workflow.name,
          workflowDescription: workflow.description,
          nodeNames: Object.keys(workflow.nodes),
        },
      });
      setText(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setAiLoading(false);
    }
  }

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-8" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl flex flex-col w-full max-w-4xl max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">{nodeName || nodeId}</h2>
            <p className="text-[10px] text-gray-400 font-mono">{nodeId}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-400">
              {wordCount} words, {charCount} chars
            </span>
            <div className="text-[10px] text-gray-400">
              <kbd className="px-1 py-0.5 bg-gray-100 rounded text-[9px]">Cmd+Enter</kbd> to save
            </div>
          </div>
        </div>

        {/* AI Actions bar */}
        {import.meta.env.DEV && (
          <div className="px-5 py-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
            <span className="text-[10px] text-gray-400 mr-1">AI:</span>
            {AI_ACTIONS.map((action) => {
              // Show "Generate" only when empty, "Improve" only when has content
              if (action.label === "Generate" && text.trim()) return null;
              if (action.label === "Improve" && !text.trim()) return null;

              return (
                <button
                  key={action.label}
                  disabled={aiLoading}
                  onClick={() => handleAiAction(action)}
                  title={action.description}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-indigo-400">
                    <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z" />
                  </svg>
                  {action.label}
                </button>
              );
            })}
            {aiLoading && (
              <div className="flex items-center gap-1.5 text-[10px] text-indigo-500 ml-2">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating...
              </div>
            )}
            {aiError && <span className="text-[10px] text-red-500 ml-2">{aiError}</span>}
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 p-5 min-h-0">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-full border border-gray-200 rounded-md px-4 py-3 text-sm font-mono resize-none focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 leading-relaxed"
            placeholder="What should Claude do at this node? Be specific about what to query, how to interpret results, what output to produce, and how to handle edge cases."
            style={{ minHeight: 350 }}
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
