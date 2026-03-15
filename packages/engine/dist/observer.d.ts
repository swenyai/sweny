import type { ExecutionEvent, RunObserver } from "./types.js";
/**
 * An in-memory RunObserver that accumulates events into an array.
 * Useful for testing and for local simulation in the studio.
 *
 * @example
 * const obs = new CollectingObserver();
 * await runWorkflow(workflow, config, providers, { observer: obs });
 * console.log(obs.events);
 */
export declare class CollectingObserver implements RunObserver {
    readonly events: ExecutionEvent[];
    onEvent(event: ExecutionEvent): void;
    /** All step:exit events, in execution order. */
    get stepResults(): Array<Extract<ExecutionEvent, {
        type: "step:exit";
    }>>;
}
/**
 * A RunObserver that forwards events to a callback.
 * Useful for one-liner integrations.
 *
 * @example
 * const obs = new CallbackObserver((e) => ws.send(JSON.stringify(e)));
 */
export declare class CallbackObserver implements RunObserver {
    private readonly callback;
    constructor(callback: (event: ExecutionEvent) => void | Promise<void>);
    onEvent(event: ExecutionEvent): void | Promise<void>;
}
/**
 * Compose multiple observers into one.
 * All observers receive every event; errors in one do not affect others.
 */
export declare function composeObservers(...observers: RunObserver[]): RunObserver;
//# sourceMappingURL=observer.d.ts.map