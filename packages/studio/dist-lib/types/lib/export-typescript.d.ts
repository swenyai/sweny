import type { RecipeDefinition } from "@sweny-ai/engine";
/**
 * Generate a TypeScript recipe file from a RecipeDefinition.
 * Output is ready to drop into a Node.js project that has @sweny-ai/engine installed.
 */
export declare function exportAsTypescript(definition: RecipeDefinition): string;
