import type { Recipe } from "../../types.js";
import type { ImplementConfig } from "./types.js";
/**
 * The implement recipe.
 *
 * Given a known issue identifier, fetches the issue, implements a fix,
 * and opens a PR. Skips the investigation/novelty phases of triage.
 *
 * Shared nodes (implement-fix, create-pr, notify) are typed to SharedNodeConfig,
 * which ImplementConfig satisfies — no type casts needed.
 */
export declare const implementRecipe: Recipe<ImplementConfig>;
export type { ImplementConfig } from "./types.js";
//# sourceMappingURL=index.d.ts.map