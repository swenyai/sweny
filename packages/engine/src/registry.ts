import type { ProviderRegistry } from "./types.js";

/** Create an empty provider registry. */
export function createProviderRegistry(): ProviderRegistry {
  const store = new Map<string, unknown>();

  return {
    get<T>(key: string): T {
      if (!store.has(key)) {
        throw new Error(`Provider "${key}" is not registered`);
      }
      return store.get(key) as T;
    },

    has(key: string): boolean {
      return store.has(key);
    },

    set(key: string, provider: unknown): void {
      store.set(key, provider);
    },
  };
}
