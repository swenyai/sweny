/** Create an empty provider registry. */
export function createProviderRegistry() {
    const store = new Map();
    return {
        get(key) {
            if (!store.has(key)) {
                throw new Error(`Provider "${key}" is not registered`);
            }
            return store.get(key);
        },
        has(key) {
            return store.has(key);
        },
        set(key, provider) {
            store.set(key, provider);
        },
    };
}
//# sourceMappingURL=registry.js.map