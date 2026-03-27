import { useState, useRef, useEffect, useCallback } from "react";
import type { Workflow } from "@sweny-ai/core";
import { buildWorkflowBrowser, refineWorkflowBrowser } from "../lib/workflow-builder-browser.js";

interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
}

interface AiChatProps {
  onWorkflowGenerated: (workflow: Workflow) => void;
  currentWorkflow: Workflow;
  hasGenerated: boolean;
}

let nextId = 0;
function msgId() {
  return `msg-${++nextId}`;
}

function workflowSummary(wf: Workflow): string {
  const nodeCount = Object.keys(wf.nodes).length;
  const edgeCount = wf.edges.length;
  const nodeNames = Object.entries(wf.nodes)
    .map(([id, n]) => n.name || id)
    .join(", ");
  return `**${wf.name}** — ${nodeCount} node${nodeCount !== 1 ? "s" : ""}, ${edgeCount} edge${edgeCount !== 1 ? "s" : ""}\n${nodeNames}`;
}

export function AiChat({ onWorkflowGenerated, currentWorkflow, hasGenerated }: AiChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: msgId(),
      role: "assistant",
      text: "Describe the workflow you want to build. I'll generate the nodes, edges, skills, and instructions.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Cmd+K focuses the input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { id: msgId(), role: "user", text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const workflow = hasGenerated
        ? await refineWorkflowBrowser(currentWorkflow, trimmed)
        : await buildWorkflowBrowser(trimmed);

      onWorkflowGenerated(workflow);

      const summary = workflowSummary(workflow);
      setMessages((prev) => [
        ...prev,
        {
          id: msgId(),
          role: "assistant",
          text: hasGenerated
            ? `Updated the workflow.\n\n${summary}\n\nDescribe further changes, or edit nodes directly on the canvas.`
            : `Created your workflow.\n\n${summary}\n\nDescribe changes to refine it, or click nodes to edit details.`,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: msgId(),
          role: "error",
          text: err instanceof Error ? err.message : "Something went wrong",
        },
      ]);
    } finally {
      setLoading(false);
      // Re-focus input after response
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, loading, hasGenerated, currentWorkflow, onWorkflowGenerated]);

  return (
    <div className="w-72 flex flex-col bg-gray-900 border-r border-gray-700 flex-shrink-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-indigo-400">
          <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z" />
        </svg>
        <span className="text-xs font-semibold text-gray-300">AI Workflow Builder</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-xs leading-relaxed whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-gray-800 text-gray-200 rounded-lg px-3 py-2 ml-4"
                : msg.role === "error"
                  ? "bg-red-900/30 text-red-300 rounded-lg px-3 py-2"
                  : "text-gray-400 px-1"
            }`}
          >
            {msg.text}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 px-1 text-xs text-gray-500">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-2 border-t border-gray-700">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={loading}
            rows={2}
            placeholder={hasGenerated ? "Describe changes..." : "Describe your workflow... (Cmd+K)"}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-50"
          />
          <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
            <button
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              className="p-1 rounded bg-indigo-600 text-white disabled:opacity-30 hover:bg-indigo-500 transition-colors"
              title="Send (Enter)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 1l14 7-14 7V9l8-1-8-1z" />
              </svg>
            </button>
          </div>
        </div>
        {!loading && <p className="text-[9px] text-gray-600 mt-1 px-1">Enter to send, Shift+Enter for newline</p>}
      </div>
    </div>
  );
}
