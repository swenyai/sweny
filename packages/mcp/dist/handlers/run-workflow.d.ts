export interface RunWorkflowInput {
    workflow: "triage" | "implement";
    /** For implement: issue ID or URL. For triage: ignored (discovers alerts automatically). */
    input?: string;
    cwd?: string;
    dryRun?: boolean;
}
export interface RunWorkflowResult {
    success: boolean;
    output: string;
    error?: string;
}
/**
 * Resolve the absolute path to the `sweny` CLI binary.
 * Uses the workspace-linked bin rather than npx to avoid
 * resolution overhead and version mismatch risk.
 */
export declare function resolveSwenyBin(): string;
export declare function runWorkflow(opts: RunWorkflowInput): Promise<RunWorkflowResult>;
