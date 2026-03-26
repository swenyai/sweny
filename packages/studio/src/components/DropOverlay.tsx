import { useState, useEffect, useCallback } from "react";
import { validateWorkflow } from "@sweny-ai/core/schema";
import type { Workflow } from "@sweny-ai/core";

interface DropOverlayProps {
  onImport(wf: Workflow): void;
}

export function DropOverlay({ onImport }: DropOverlayProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  }, []);

  const onDragLeave = useCallback(() => setIsDragging(false), []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      setError(null);

      const file = e.dataTransfer?.files[0];
      if (!file) return;
      if (!file.name.endsWith(".json")) {
        setError("Only .json files are supported");
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          const errors = validateWorkflow(parsed);
          if (errors.length > 0) {
            setError(errors.map((e) => `[${e.code}] ${e.message}`).join("\n"));
            return;
          }
          onImport(parsed as Workflow);
        } catch (e) {
          setError(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      reader.readAsText(file);
    },
    [onImport],
  );

  useEffect(() => {
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onDragOver, onDragLeave, onDrop]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <>
      {isDragging && (
        <div className="fixed inset-0 bg-blue-500/20 border-4 border-dashed border-blue-500 z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-lg px-8 py-6 shadow-xl text-center">
            <p className="font-semibold text-gray-800">Drop .workflow.json to import</p>
          </div>
        </div>
      )}
      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-600 text-white text-xs px-4 py-2 rounded shadow-lg z-50 max-w-sm text-center">
          {error}
        </div>
      )}
    </>
  );
}
