import type { Workflow } from "../../types.js";
import type { ImplementConfig } from "./types.js";
/**
 * The implement recipe.
 *
 * Given a known issue identifier, fetches the issue, implements a fix,
 * and opens a PR. Skips the investigation/novelty phases of triage.
 *
 * Steps that were written for TriageConfig are reused via cast — they only
 * access the config fields that ImplementConfig also provides.
 */
export declare const implementWorkflow: Workflow<ImplementConfig>;
export type { ImplementConfig } from "./types.js";
//# sourceMappingURL=index.d.ts.map