/**
 * An in-memory RunObserver that accumulates events into an array.
 * Useful for testing and for local simulation in the studio.
 *
 * @example
 * const obs = new CollectingObserver();
 * await runRecipe(recipe, config, providers, { observer: obs });
 * console.log(obs.events);
 */
export class CollectingObserver {
    events = [];
    onEvent(event) {
        this.events.push(event);
    }
    /** All state:exit events, in execution order. */
    get stateResults() {
        return this.events.filter((e) => e.type === "state:exit");
    }
}
/**
 * A RunObserver that forwards events to a callback.
 * Useful for one-liner integrations.
 *
 * @example
 * const obs = new CallbackObserver((e) => ws.send(JSON.stringify(e)));
 */
export class CallbackObserver {
    callback;
    constructor(callback) {
        this.callback = callback;
    }
    onEvent(event) {
        return this.callback(event);
    }
}
/**
 * Compose multiple observers into one.
 * All observers receive every event; errors in one do not affect others.
 */
export function composeObservers(...observers) {
    return {
        async onEvent(event) {
            await Promise.allSettled(observers.map((o) => o.onEvent(event)));
        },
    };
}
//# sourceMappingURL=observer.js.map