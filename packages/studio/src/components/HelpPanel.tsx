import { useEffect } from "react";

interface HelpPanelProps {
  onClose(): void;
}

const SHORTCUTS = [
  { keys: ["⌘", "Z"], description: "Undo" },
  { keys: ["⌘", "⇧", "Z"], description: "Redo" },
  { keys: ["⌘", "O"], description: "Import workflow" },
  { keys: ["Backspace"], description: "Delete selected step" },
  { keys: ["Escape"], description: "Deselect / close panel" },
  { keys: ["?"], description: "Show this help" },
];

export function HelpPanel({ onClose }: HelpPanelProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-2xl w-96 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
            ×
          </button>
        </div>

        <table className="w-full text-sm mb-5">
          <tbody>
            {SHORTCUTS.map(({ keys, description }) => (
              <tr key={description} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-1">
                    {keys.map((k) => (
                      <kbd
                        key={k}
                        className="px-1.5 py-0.5 rounded bg-gray-100 border border-gray-300 text-xs font-mono text-gray-700"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </td>
                <td className="py-2 text-gray-600">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="bg-gray-50 rounded p-3 text-xs text-gray-500 space-y-1">
          <p>
            <strong className="text-gray-700">Design</strong> — edit steps, transitions, and properties. Export as YAML,
            JSON, or TypeScript.
          </p>
          <p>
            <strong className="text-gray-700">Simulate</strong> — run the workflow locally in the browser.
          </p>
          <p>
            <strong className="text-gray-700">Live</strong> — connect to a running engine over WebSocket or SSE.
          </p>
        </div>
      </div>
    </div>
  );
}
