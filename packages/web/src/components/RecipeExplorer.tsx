import { useState } from "react";
import { RecipeViewer } from "@sweny-ai/studio/viewer";
import { triageDefinition, implementDefinition } from "@sweny-ai/engine/browser";
import "@sweny-ai/studio/style.css";
import type { RecipeDefinition } from "@sweny-ai/engine/browser";

const RECIPES: { label: string; definition: RecipeDefinition }[] = [
  { label: "Triage", definition: triageDefinition as RecipeDefinition },
  { label: "Implement", definition: implementDefinition as RecipeDefinition },
];

export function RecipeExplorer() {
  const [activeIdx, setActiveIdx] = useState(0);

  return (
    <div style={{ fontFamily: "inherit" }}>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        {RECIPES.map((r, i) => (
          <button
            key={r.label}
            onClick={() => setActiveIdx(i)}
            style={{
              padding: "0.35rem 0.9rem",
              borderRadius: "0.375rem",
              border: "1px solid",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
              background: activeIdx === i ? "#6366f1" : "transparent",
              color: activeIdx === i ? "#fff" : "inherit",
              borderColor: activeIdx === i ? "#6366f1" : "#d1d5db",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div
        style={{
          height: 480,
          borderRadius: "0.5rem",
          overflow: "hidden",
          border: "1px solid #e5e7eb",
        }}
      >
        <RecipeViewer definition={RECIPES[activeIdx].definition} height={480} />
      </div>
      <p
        style={{
          marginTop: "0.5rem",
          fontSize: "0.75rem",
          color: "#6b7280",
          textAlign: "center",
        }}
      >
        Scroll to zoom · drag to pan · click a node to inspect
      </p>
    </div>
  );
}
