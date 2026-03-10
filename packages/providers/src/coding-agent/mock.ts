import type { CodingAgent, CodingAgentRunOptions, AgentEventHandler } from "./types.js";

export interface MockCodingAgentConfig {
  /**
   * Called when run() is invoked. Use this to write fixture files, assert
   * prompts, or simulate agent-side side effects.
   */
  onRun?: (opts: CodingAgentRunOptions) => void | Promise<void>;
  /** Exit code returned from run(). Defaults to 0 (success). */
  exitCode?: number;
  onEvent?: AgentEventHandler;
}

/**
 * A no-op coding agent for use in tests and local file-provider E2E runs.
 * install() is a no-op. run() calls onRun (if provided) and returns exitCode.
 */
export function mockAgent(config?: MockCodingAgentConfig): CodingAgent {
  return {
    async install(): Promise<void> {},

    async run(opts: CodingAgentRunOptions): Promise<number> {
      await config?.onRun?.(opts);
      if (config?.onEvent) {
        await config.onEvent({ type: "text", text: "mock agent run" });
      }
      return config?.exitCode ?? 0;
    },
  };
}
