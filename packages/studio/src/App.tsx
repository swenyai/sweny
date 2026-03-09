import { triageDefinition } from "@sweny-ai/engine";
import { RecipeViewer } from "./RecipeViewer.js";

export function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <RecipeViewer definition={triageDefinition} />
    </div>
  );
}
