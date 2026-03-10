import type { RecipeDefinition } from "@sweny-ai/engine";
/**
 * Encode a RecipeDefinition as a URL-safe base64 string.
 */
export declare function encodeRecipe(definition: RecipeDefinition): string;
/**
 * Decode a base64 string from the URL hash back to a RecipeDefinition.
 * Returns null if the hash is missing, malformed, or fails validation.
 */
export declare function decodeRecipe(encoded: string): RecipeDefinition | null;
/**
 * Read the recipe from the current URL hash, if present.
 * Returns null if no #def= found or if decode fails.
 */
export declare function readPermalinkFromHash(): RecipeDefinition | null;
/**
 * Build a shareable URL for the given definition.
 */
export declare function buildPermalinkUrl(definition: RecipeDefinition): string;
