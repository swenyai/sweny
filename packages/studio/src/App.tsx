import { useState } from "react";
import { triageDefinition, implementDefinition } from "@sweny-ai/engine";
import { RecipeViewer } from "./RecipeViewer.js";
import type { RecipeDefinition } from "@sweny-ai/engine";

const recipes: Record<string, RecipeDefinition> = {
  triage: triageDefinition,
  implement: implementDefinition,
};

export function App() {
  const [active, setActive] = useState<string>("triage");

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm border-b border-gray-700">
        <span className="font-bold text-white mr-2">sweny studio</span>
        {Object.keys(recipes).map((key) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            className={`px-3 py-1 rounded text-sm ${
              active === key ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {key}
          </button>
        ))}
      </div>
      {/* Canvas */}
      <div style={{ flex: 1 }}>
        <RecipeViewer definition={recipes[active]!} />
      </div>
    </div>
  );
}
