import type { DefinitionError, RecipeDefinition } from "./types.js";
/**
 * Validate a RecipeDefinition for structural correctness.
 * Returns an array of errors (empty array = valid).
 * Does NOT check implementations (use createRecipe for that).
 *
 * Pure function — no Node.js dependencies, safe for browser use.
 */
export declare function validateDefinition(def: RecipeDefinition): DefinitionError[];
//# sourceMappingURL=validate.d.ts.map