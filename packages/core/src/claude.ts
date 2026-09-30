/**
 * Back-compat shim. The Claude Code adapter moved to `./harness/claude-code.ts`
 * as `ClaudeCodeHarness` (#330). Existing imports of `./claude.js` keep working.
 */
export * from "./harness/claude-code.js";
