import type { RecipeDefinition } from "@sweny-ai/engine";
interface DropOverlayProps {
  onImport(def: RecipeDefinition): void;
}
export declare function DropOverlay({ onImport }: DropOverlayProps): import("react/jsx-runtime").JSX.Element;
export {};
