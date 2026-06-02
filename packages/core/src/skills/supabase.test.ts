import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase, assertSupabaseIdentifier, assertSupabaseFunctionName, appendPostgrestFilters } from "./supabase.js";
import type { ToolContext } from "../types.js";

const ctx = (extra: Record<string, string> = {}): ToolContext => ({
  config: {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ...extra,
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function tool(name: string) {
  const t = supabase.tools.find((t) => t.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

// ─── Input hardening (issue #226) ─────────────────────────────────
//
// Threat model: this skill runs with SUPABASE_SERVICE_ROLE_KEY (full RLS
// bypass), and `table`, `filters[]`, and function names are LLM-controlled.
// Identifiers are validated, filter values are URL-encoded so a single
// filter string cannot smuggle extra query parameters, and an optional
// allowlist bounds which tables/functions the agent can touch.

describe("assertSupabaseIdentifier", () => {
  it("accepts normal table names", () => {
    expect(assertSupabaseIdentifier("games")).toBe("games");
    expect(assertSupabaseIdentifier("course_modules")).toBe("course_modules");
  });

  it("rejects names that alter the request path or query", () => {
    expect(() => assertSupabaseIdentifier("games?select=secret")).toThrow(/identifier/i);
    expect(() => assertSupabaseIdentifier("games/../auth")).toThrow(/identifier/i);
    expect(() => assertSupabaseIdentifier("rpc/exec")).toThrow(/identifier/i);
  });

  it("rejects an empty string", () => {
    expect(() => assertSupabaseIdentifier("")).toThrow(/identifier/i);
  });
});

describe("assertSupabaseFunctionName", () => {
  it("accepts edge function names with hyphens", () => {
    expect(assertSupabaseFunctionName("agent-gateway")).toBe("agent-gateway");
  });

  it("rejects path traversal and query injection", () => {
    expect(() => assertSupabaseFunctionName("../auth/v1/admin")).toThrow(/function name/i);
    expect(() => assertSupabaseFunctionName("fn?x=1")).toThrow(/function name/i);
  });
});

describe("appendPostgrestFilters", () => {
  it("appends a normal filter as a key/value pair", () => {
    const params = new URLSearchParams();
    appendPostgrestFilters(params, ["subject=eq.math"]);
    expect(params.get("subject")).toBe("eq.math");
  });

  it("encodes & and = in filter values so they cannot smuggle extra parameters", () => {
    const params = new URLSearchParams();
    appendPostgrestFilters(params, ["name=eq.a&select=password"]);
    // The whole right-hand side stays one value on the `name` key.
    expect(params.get("name")).toBe("eq.a&select=password");
    expect(params.get("select")).toBeNull();
    expect(params.toString()).toContain("eq.a%26select%3Dpassword");
  });

  it("throws on a filter with no = separator", () => {
    expect(() => appendPostgrestFilters(new URLSearchParams(), ["not-a-filter"])).toThrow(/filter/i);
  });
});

describe("supabase_query hardening", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const query = tool("supabase_query");

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends filters as encoded query parameters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await query.handler({ table: "games", filters: ["subject=eq.math", "difficulty=eq.easy"] }, ctx());

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/rest/v1/games?");
    expect(url).toContain("subject=eq.math");
    expect(url).toContain("difficulty=eq.easy");
  });

  it("keeps an &-containing filter value on a single parameter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await query.handler({ table: "games", filters: ["title=eq.a&select=secret_column"] }, ctx());

    const url = fetchMock.mock.calls[0][0] as string;
    // The smuggled select must appear encoded, never as a standalone parameter.
    expect(url).toContain("title=eq.a%26select%3Dsecret_column");
    expect(url).not.toContain("&select=secret_column");
  });

  it("rejects a table name that is not a bare identifier, without making any request", async () => {
    await expect(query.handler({ table: "games?select=x" }, ctx())).rejects.toThrow(/identifier/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces SUPABASE_ALLOWED_TABLES when configured", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const allowCtx = ctx({ SUPABASE_ALLOWED_TABLES: "games, profiles" });

    await query.handler({ table: "games" }, allowCtx);
    expect(fetchMock).toHaveBeenCalledOnce();

    await expect(query.handler({ table: "users" }, allowCtx)).rejects.toThrow(/allowlist|allowed/i);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows any valid table when no allowlist is configured", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await query.handler({ table: "anything_goes" }, ctx());
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("supabase write-tool hardening", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("update encodes filters and validates the table", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await tool("supabase_update").handler(
      { table: "games", filters: ["id=eq.1&id=eq.2"], data: { title: "x" } },
      ctx(),
    );

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("id=eq.1%26id%3Deq.2");
  });

  it("update still requires filters (full-table update guard preserved)", async () => {
    await expect(
      tool("supabase_update").handler({ table: "games", filters: [], data: { a: 1 } }, ctx()),
    ).rejects.toThrow(/filters are required/i);
  });

  it("delete still requires filters and validates the table", async () => {
    await expect(tool("supabase_delete").handler({ table: "games", filters: [] }, ctx())).rejects.toThrow(
      /filters are required/i,
    );
    await expect(tool("supabase_delete").handler({ table: "a/b", filters: ["id=eq.1"] }, ctx())).rejects.toThrow(
      /identifier/i,
    );
  });

  it("insert validates the table against the allowlist", async () => {
    const allowCtx = ctx({ SUPABASE_ALLOWED_TABLES: "games" });
    await expect(tool("supabase_insert").handler({ table: "secrets", rows: [{ a: 1 }] }, allowCtx)).rejects.toThrow(
      /allowlist|allowed/i,
    );
  });

  it("count encodes filters", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200, headers: { "content-range": "0-9/10" } }));

    await tool("supabase_count").handler({ table: "games", filters: ["x=eq.a&y=eq.b"] }, ctx());

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("x=eq.a%26y%3Deq.b");
  });
});

describe("supabase function-tool hardening", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rpc rejects function names that escape the /rpc/ path", async () => {
    await expect(tool("supabase_rpc").handler({ function_name: "../auth/v1/admin/users" }, ctx())).rejects.toThrow(
      /identifier|function name/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rpc enforces SUPABASE_ALLOWED_FUNCTIONS when configured", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const allowCtx = ctx({ SUPABASE_ALLOWED_FUNCTIONS: "get_table_counts" });

    await tool("supabase_rpc").handler({ function_name: "get_table_counts" }, allowCtx);
    expect(fetchMock).toHaveBeenCalledOnce();

    await expect(tool("supabase_rpc").handler({ function_name: "delete_everything" }, allowCtx)).rejects.toThrow(
      /allowlist|allowed/i,
    );
  });

  it("invoke_function accepts hyphenated names and rejects path traversal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await tool("supabase_invoke_function").handler({ function_name: "agent-gateway", body: {} }, ctx());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://proj.supabase.co/functions/v1/agent-gateway");

    await expect(
      tool("supabase_invoke_function").handler({ function_name: "../../auth/v1/admin", body: {} }, ctx()),
    ).rejects.toThrow(/function name/i);
  });

  it("invoke_function enforces SUPABASE_ALLOWED_FUNCTIONS when configured", async () => {
    const allowCtx = ctx({ SUPABASE_ALLOWED_FUNCTIONS: "agent-gateway" });
    await expect(
      tool("supabase_invoke_function").handler({ function_name: "seed-content", body: {} }, allowCtx),
    ).rejects.toThrow(/allowlist|allowed/i);
  });
});

// ─── Regression: existing legitimate behavior ─────────────────────

describe("supabase existing behavior", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("query defaults select=* and limit=100", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1 }]));

    const result: any = await tool("supabase_query").handler({ table: "games" }, ctx());

    expect(result).toEqual([{ id: 1 }]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("select=*");
    expect(url).toContain("limit=100");
  });

  it("query passes order and custom select through", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await tool("supabase_query").handler({ table: "games", select: "id,title", order: "created_at.desc" }, ctx());

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("select=id%2Ctitle");
    expect(url).toContain("order=created_at.desc");
  });

  it("insert posts rows with service role auth", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1 }]));

    await tool("supabase_insert").handler({ table: "games", rows: [{ title: "t" }] }, ctx());

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/rest/v1/games");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer service-role-key");
    expect(JSON.parse(opts.body)).toEqual([{ title: "t" }]);
  });

  it("rpc posts params to /rpc/<name>", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ count: 3 }));

    await tool("supabase_rpc").handler({ function_name: "get_table_counts", params: { schema: "public" } }, ctx());

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/rest/v1/rpc/get_table_counts");
    expect(JSON.parse(opts.body)).toEqual({ schema: "public" });
  });
});
