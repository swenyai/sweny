import { useState, useRef, useEffect } from "react";
import { getSkillCatalog } from "@sweny-ai/core/studio";
import { buildWorkflowBrowser, refineWorkflowBrowser } from "../lib/workflow-builder-browser.js";
import { getStoredApiKey } from "../lib/generate-instruction.js";

const catalog = getSkillCatalog();
const skills = catalog.map((s) => ({ id: s.id, name: s.name, description: s.description }));

interface WorkflowPromptBarProps {
  onWorkflowGenerated: (workflow: import("@sweny-ai/core").Workflow) => void;
  currentWorkflow: import("@sweny-ai/core").Workflow;
  hasGenerated: boolean;
}

export function WorkflowPromptBar({ onWorkflowGenerated, currentWorkflow, hasGenerated }: WorkflowPromptBarProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K focuses the prompt bar
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

  async function handleSubmit() {
    const apiKey = getStoredApiKey();
    if (!apiKey) {
      setError("Set your Anthropic API key in Settings (gear icon) first");
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const workflow = hasGenerated
        ? await refineWorkflowBrowser(currentWorkflow, trimmed, { apiKey, skills })
        : await buildWorkflowBrowser(trimmed, { apiKey, skills });
      onWorkflowGenerated(workflow);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate workflow");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex-shrink-0">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) handleSubmit();
            }}
            disabled={loading}
            placeholder={
              hasGenerated ? "Describe changes to refine the workflow..." : "Describe your workflow... (Cmd+K)"
            }
            className={`w-full border rounded-md px-3 py-2 text-sm pr-16 focus:outline-none focus:ring-1 ${
              error
                ? "border-red-300 focus:border-red-400 focus:ring-red-200"
                : "border-gray-200 focus:border-indigo-300 focus:ring-indigo-200"
            } ${loading ? "opacity-60" : ""}`}
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {!loading && (
              <span className="text-[9px] text-gray-300">
                <kbd className="px-1 py-0.5 bg-gray-100 rounded">Enter</kbd>
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleSubmit}
          disabled={loading || !prompt.trim()}
          className="px-4 py-2 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
        >
          {loading ? (
            <>
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
            </>
          ) : hasGenerated ? (
            "Refine"
          ) : (
            "Generate"
          )}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
