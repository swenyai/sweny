import type { RecipeDefinition } from "@sweny-ai/engine";
interface ImportModalProps {
  onImport(def: RecipeDefinition): void;
  onClose(): void;
}
export declare function ImportModal({ onImport, onClose }: ImportModalProps): import("react/jsx-runtime").JSX.Element;
export {};
