export interface WorkflowInfo {
    id: string;
    name: string;
    description: string;
    nodeCount: number;
    source: "builtin" | "custom";
}
export declare function listWorkflows(cwd: string): Promise<WorkflowInfo[]>;
