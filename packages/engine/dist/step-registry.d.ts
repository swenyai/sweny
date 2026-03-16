import type { WorkflowContext, StepResult, WorkflowDefinition, Workflow } from "./types.js";
type AnyStepImpl = (ctx: WorkflowContext<any>) => Promise<StepResult>;
export interface StepType {
    /** Identifier used in YAML, e.g. "sweny/fetch-issue" */
    type: string;
    /** Human-readable description shown in Studio and CLI help */
    description: string;
    /** The implementation */
    impl: AnyStepImpl;
}
/** Global registry of built-in step types */
export declare const builtinStepRegistry: Map<string, StepType>;
export declare function registerStepType(entry: StepType): void;
/**
 * Return all registered step types as plain data (no impl function).
 * Call this after importing '@sweny-ai/engine/builtin-steps' to include built-ins.
 */
export declare function listStepTypes(): Array<{
    type: string;
    description: string;
}>;
/**
 * Resolve a WorkflowDefinition into a runnable Workflow by looking up
 * each step's `type` field in the built-in step registry.
 *
 * Steps without a `type` field will throw. For custom implementations,
 * use createWorkflow() directly.
 */
export declare function resolveWorkflow<TConfig>(definition: WorkflowDefinition): Workflow<TConfig>;
export {};
//# sourceMappingURL=step-registry.d.ts.map