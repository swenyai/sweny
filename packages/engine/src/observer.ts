import type { ExecutionEvent, RunObserver } from "./types.js";

/**
 * An in-memory RunObserver that accumulates events into an array.
 * Useful for testing and for local simulation in the studio.
 *
 * @example
 * const obs = new CollectingObserver();
 * await runRecipe(recipe, config, providers, { observer: obs });
 * console.log(obs.events);
 */
export class CollectingObserver implements RunObserver {
  readonly events: ExecutionEvent[] = [];

  onEvent(event: ExecutionEvent): void {
    this.events.push(event);
  }

  /** All state:exit events, in execution order. */
  get stateResults(): Array<Extract<ExecutionEvent, { type: "state:exit" }>> {
    return this.events.filter(
      (e): e is Extract<ExecutionEvent, { type: "state:exit" }> => e.type === "state:exit",
    );
  }
}

/**
 * A RunObserver that forwards events to a callback.
 * Useful for one-liner integrations.
 *
 * @example
 * const obs = new CallbackObserver((e) => ws.send(JSON.stringify(e)));
 */
export class CallbackObserver implements RunObserver {
  constructor(private readonly callback: (event: ExecutionEvent) => void | Promise<void>) {}

  onEvent(event: ExecutionEvent): void | Promise<void> {
    return this.callback(event);
  }
}

/**
 * Compose multiple observers into one.
 * All observers receive every event; errors in one do not affect others.
 */
export function composeObservers(...observers: RunObserver[]): RunObserver {
  return {
    async onEvent(event: ExecutionEvent) {
      await Promise.allSettled(observers.map((o) => o.onEvent(event)));
    },
  };
}
