import { tool } from "@anthropic-ai/claude-code";
import type { AgentTool } from "@sweny/providers/agent-tool";

type SdkTool = ReturnType<typeof tool<any>>;

/**
 * Convert a universal AgentTool into the Claude Code SDK's tool format.
 * This is the only bridge between the SDK-agnostic plugin layer and
 * the Claude-specific MCP server.
 */
export function toSdkTool(agentTool: AgentTool): SdkTool {
  return tool(
    agentTool.name,
    agentTool.description,
    agentTool.schema,
    agentTool.execute,
  );
}

/**
 * Convert an array of AgentTools to SDK tools.
 */
export function toSdkTools(agentTools: AgentTool[]): SdkTool[] {
  return agentTools.map(toSdkTool);
}
