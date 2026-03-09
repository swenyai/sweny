import type { DefinitionError, RecipeDefinition } from "./types.js";

/**
 * Validate a RecipeDefinition for structural correctness.
 * Returns an array of errors (empty array = valid).
 * Does NOT check implementations (use createRecipe for that).
 *
 * Pure function — no Node.js dependencies, safe for browser use.
 */
export function validateDefinition(def: RecipeDefinition): DefinitionError[] {
  const errors: DefinitionError[] = [];
  const stateIds = new Set(Object.keys(def.states));

  // initial must exist
  if (!stateIds.has(def.initial)) {
    errors.push({
      code: "MISSING_INITIAL",
      message: `initial state "${def.initial}" does not exist in states`,
    });
  }

  // all on/next targets must be valid state ids or "end"
  for (const [stateId, state] of Object.entries(def.states)) {
    if (state.next && state.next !== "end" && !stateIds.has(state.next)) {
      errors.push({
        code: "UNKNOWN_TARGET",
        message: `state "${stateId}" next target "${state.next}" does not exist`,
        stateId,
        targetId: state.next,
      });
    }
    for (const [outcome, target] of Object.entries(state.on ?? {})) {
      if (target !== "end" && !stateIds.has(target)) {
        errors.push({
          code: "UNKNOWN_TARGET",
          message: `state "${stateId}" on["${outcome}"] target "${target}" does not exist`,
          stateId,
          targetId: target,
        });
      }
    }
  }

  return errors;
}
