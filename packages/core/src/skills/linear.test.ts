import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linear } from "./linear.js";
import type { ToolContext } from "../types.js";

const ctx = (): ToolContext => ({
  config: { LINEAR_API_KEY: "test-token" },
  logger: console,
});

const listLabels = linear.tools.find((t) => t.name === "linear_list_labels")!;

function gqlResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("linear_list_labels", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scopes the query to a team when teamId is provided", async () => {
    fetchMock.mockResolvedValueOnce(
      gqlResponse({ team: { labels: { nodes: [{ id: "lab_1", name: "agent", color: "#000" }] } } }),
    );

    const result: any = await listLabels.handler({ teamId: "team_abc" }, ctx());

    expect(result.team.labels.nodes[0]).toMatchObject({ name: "agent" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.variables).toEqual({ teamId: "team_abc" });
    expect(sent.query).toContain("team(id: $teamId)");
  });

  it("falls back to a workspace-wide query when teamId is omitted", async () => {
    fetchMock.mockResolvedValueOnce(
      gqlResponse({
        issueLabels: {
          nodes: [
            { id: "lab_1", name: "sweny", color: "#111", team: { key: "OFF" } },
            { id: "lab_2", name: "triage", color: "#222", team: { key: "OFF" } },
          ],
        },
      }),
    );

    const result: any = await listLabels.handler({}, ctx());

    expect(result.issueLabels.nodes).toHaveLength(2);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.variables).toEqual({});
    expect(sent.query).toContain("issueLabels");
  });

  it("is exposed as an alias for the Linear MCP list_issue_labels tool", () => {
    expect(linear.mcpAliases?.linear_list_labels).toEqual(["list_issue_labels"]);
  });
});
