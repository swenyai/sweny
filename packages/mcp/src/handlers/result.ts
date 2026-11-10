/** What every read-only tool handler returns: a short summary, a structured payload, and whether it failed. */
export interface ToolOutput {
  /** True only when the tool could not do its job (bad path, nothing to diff). An invalid workflow is not an error. */
  isError: boolean;
  summary: string;
  data: unknown;
}

/** MCP content: the summary first, then the payload as JSON. */
export function toContent(out: ToolOutput): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  return {
    content: [
      { type: "text", text: out.summary },
      { type: "text", text: JSON.stringify(out.data, null, 2) },
    ],
    ...(out.isError ? { isError: true } : {}),
  };
}

export const fail = (error: string, data: Record<string, unknown> = {}): ToolOutput => ({
  isError: true,
  summary: error,
  data: { error, ...data },
});
