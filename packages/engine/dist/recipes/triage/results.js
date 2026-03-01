/**
 * Get typed step result data from the workflow context.
 *
 * Replaces unsafe casts like `ctx.results.get("investigate")?.data as unknown as T`.
 * Step name is checked at compile time — typos are caught immediately.
 *
 * @example
 * const investigation = getStepData(ctx, "investigate");
 * //    ^? InvestigationResult | undefined
 */
export function getStepData(ctx, stepName) {
    return ctx.results.get(stepName)?.data;
}
//# sourceMappingURL=results.js.map