import type { ExecutionEvent } from "@sweny-ai/core";
interface CloudStreamConfig {
    cloudUrl: string;
    projectToken?: string;
    installationId?: string;
    owner: string;
    repo: string;
}
/**
 * Creates a cloud streaming reporter that sends execution events to the
 * SWEny Cloud dashboard for live DAG visualization.
 *
 * Events are fire-and-forget — failures never block workflow execution.
 */
export declare function createCloudStreamReporter(config: CloudStreamConfig): {
    onEvent(event: ExecutionEvent): void;
    getRunId(): string | null;
    /** Wait for all pending events to flush */
    flush(): Promise<void>;
};
export {};
//# sourceMappingURL=cloud-stream.d.ts.map