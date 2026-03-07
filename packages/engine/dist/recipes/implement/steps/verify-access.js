/** Verify that issue tracker and source control providers are reachable. */
export async function verifyAccess(ctx) {
    const issueTracker = ctx.providers.get("issueTracker");
    await issueTracker.verifyAccess();
    ctx.logger.info("Issue tracker access verified");
    const sourceControl = ctx.providers.get("sourceControl");
    await sourceControl.verifyAccess();
    ctx.logger.info("Source control access verified");
    return { status: "success" };
}
//# sourceMappingURL=verify-access.js.map