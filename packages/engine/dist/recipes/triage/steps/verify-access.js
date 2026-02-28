/** Verify that observability and issue tracker providers are reachable. */
export async function verifyAccess(ctx) {
    const observability = ctx.providers.get("observability");
    await observability.verifyAccess();
    ctx.logger.info("Observability provider access verified");
    const issueTracker = ctx.providers.get("issueTracker");
    await issueTracker.verifyAccess();
    ctx.logger.info("Issue tracker access verified");
    return { status: "success" };
}
//# sourceMappingURL=verify-access.js.map