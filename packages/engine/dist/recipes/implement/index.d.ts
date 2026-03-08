import type { Workflow } from "../../types.js";
import type { ImplementConfig } from "./types.js";
/**
 * The implement recipe.
 *
 * Given a known issue identifier, fetches the issue, implements a fix,
 * and opens a PR. Skips the investigation/novelty phases of triage.
 */
export declare const implementWorkflow: Workflow<ImplementConfig>;
export type { ImplementConfig } from "./types.js";
//# sourceMappingURL=index.d.ts.map