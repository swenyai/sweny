import { useState } from "react";
import { parse as parseYaml } from "yaml";
import { validateWorkflow } from "@sweny-ai/engine";
import type { WorkflowDefinition } from "@sweny-ai/engine";

interface ImportModalProps {
  onImport(def: WorkflowDefinition): void;
  onClose(): void;
}

function parseInput(raw: string): unknown {
  // Try JSON first; fall back to YAML
  try {
    return JSON.parse(raw);
  } catch {
    return parseYaml(raw);
  }
}

export function ImportModal({ onImport, onClose }: ImportModalProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleImport() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = parseInput(text);
    } catch (e) {
      setError(`Could not parse input as JSON or YAML: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).id !== "string" ||
      typeof (parsed as Record<string, unknown>).version !== "string" ||
      typeof (parsed as Record<string, unknown>).name !== "string" ||
      typeof (parsed as Record<string, unknown>).initial !== "string" ||
      typeof (parsed as Record<string, unknown>).steps !== "object"
    ) {
      setError("Does not match WorkflowDefinition shape: missing required fields (id, version, name, initial, steps)");
      return;
    }

    const def = parsed as WorkflowDefinition;

    const errors = validateWorkflow(def);
    if (errors.length > 0) {
      setError("Workflow definition has errors:\n" + errors.map((e) => `  [${e.code}] ${e.message}`).join("\n"));
      return;
    }

    onImport(def);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-800 text-sm">Import Workflow</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
            ×
          </button>
        </div>

        <div className="flex-1 p-4 overflow-auto">
          <p className="text-xs text-gray-500 mb-2">
            Paste a workflow YAML or JSON. Must have <code>id</code>, <code>version</code>, <code>name</code>,{" "}
            <code>initial</code>, and <code>steps</code>.
          </p>
          <textarea
            className="w-full h-64 font-mono text-xs border border-gray-300 rounded p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder={
              'id: my-workflow\nversion: "1.0.0"\nname: My Workflow\ninitial: verify-access\nsteps:\n  verify-access:\n    phase: learn\n    type: sweny/verify-access'
            }
            spellCheck={false}
          />
          {error && (
            <pre className="mt-2 text-xs text-red-600 bg-red-50 rounded p-2 whitespace-pre-wrap overflow-auto max-h-32">
              {error}
            </pre>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!text.trim()}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
