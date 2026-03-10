interface ToolbarProps {
  onRecipeChange(id: string): void;
  activeRecipeId: string;
  availableRecipes: Array<{
    id: string;
    name: string;
  }>;
  showImport: boolean;
  onShowImportChange(open: boolean): void;
}
export declare function Toolbar({
  onRecipeChange,
  activeRecipeId,
  availableRecipes,
  showImport,
  onShowImportChange,
}: ToolbarProps): import("react/jsx-runtime").JSX.Element;
export {};
