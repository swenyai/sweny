import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterstack, assertClickHouseIdentifier, prepareReadOnlyQuery } from "./betterstack.js";
import type { ToolContext } from "../types.js";

const ctx = (): ToolContext => ({
  config: {
    BETTERSTACK_API_TOKEN: "test-token",
    BETTERSTACK_QUERY_ENDPOINT: "https://eu-test-connect.betterstackdata.com",
    BETTERSTACK_QUERY_USERNAME: "user",
    BETTERSTACK_QUERY_PASSWORD: "pass",
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
});

function ndjsonResponse(lines: unknown[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join("\n"), { status: 200 });
}

// ─── Input hardening (issue #226) ─────────────────────────────────
//
// Threat model: `table` and `query` are LLM-controlled and reach a
// ClickHouse query string. The identifier must be strictly validated;
// the read-only query guard is best-effort UX, not a security boundary
// (that boundary is a read-only ClickHouse role on the connection).

describe("assertClickHouseIdentifier", () => {
  it("accepts a normal source table name", () => {
    expect(assertClickHouseIdentifier("t273774_offload_ecs_production")).toBe("t273774_offload_ecs_production");
  });

  it("rejects identifier injection via parens/spaces", () => {
    expect(() => assertClickHouseIdentifier("t1) UNION SELECT * FROM system.users --")).toThrow(/identifier/i);
  });

  it("rejects quotes and backticks", () => {
    expect(() => assertClickHouseIdentifier("t1`; DROP TABLE x")).toThrow(/identifier/i);
    expect(() => assertClickHouseIdentifier("t1'_logs")).toThrow(/identifier/i);
  });

  it("rejects an empty string", () => {
    expect(() => assertClickHouseIdentifier("")).toThrow(/identifier/i);
  });
});

describe("prepareReadOnlyQuery", () => {
  it("accepts a SELECT and appends a LIMIT cap", () => {
    expect(prepareReadOnlyQuery("SELECT dt, raw FROM remote(t1_logs)")).toBe(
      "SELECT dt, raw FROM remote(t1_logs) LIMIT 500",
    );
  });

  it("accepts WITH ... CTEs (previously over-rejected)", () => {
    const sql = "WITH errs AS (SELECT * FROM remote(t1_logs)) SELECT count() FROM errs";
    expect(prepareReadOnlyQuery(sql)).toBe(`${sql} LIMIT 500`);
  });

  it("accepts DESCRIBE", () => {
    expect(prepareReadOnlyQuery("DESCRIBE TABLE remote(t1_logs)")).toBe("DESCRIBE TABLE remote(t1_logs)");
  });

  it("does not double-append when a real LIMIT is present", () => {
    const sql = "SELECT * FROM remote(t1_logs) LIMIT 10";
    expect(prepareReadOnlyQuery(sql)).toBe(sql);
  });

  it("appends LIMIT when the word LIMIT only appears inside a string literal", () => {
    const sql = "SELECT * FROM remote(t1_logs) WHERE raw LIKE '%rate LIMIT exceeded%'";
    expect(prepareReadOnlyQuery(sql)).toBe(`${sql} LIMIT 500`);
  });

  it("rejects non-read statements", () => {
    expect(() => prepareReadOnlyQuery("INSERT INTO t1 VALUES (1)")).toThrow(/SELECT|read-only/i);
    expect(() => prepareReadOnlyQuery("DROP TABLE t1")).toThrow(/SELECT|read-only/i);
  });

  it("rejects multi-statement queries", () => {
    expect(() => prepareReadOnlyQuery("SELECT 1; DROP TABLE t1")).toThrow(/multi|single/i);
  });

  it("tolerates a trailing semicolon", () => {
    expect(prepareReadOnlyQuery("SELECT 1;")).toBe("SELECT 1 LIMIT 500");
  });

  it("does not treat a semicolon inside a string literal as a statement separator", () => {
    const sql = "SELECT * FROM remote(t1_logs) WHERE raw LIKE '%a;b%' LIMIT 5";
    expect(prepareReadOnlyQuery(sql)).toBe(sql);
  });
});

describe("betterstack tool handlers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const getSourceFields = betterstack.tools.find((t) => t.name === "betterstack_get_source_fields")!;
  const query = betterstack.tools.find((t) => t.name === "betterstack_query")!;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("get_source_fields sends DESCRIBE for a valid table", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse([{ name: "dt", type: "DateTime64(6)" }]));

    const result: any = await getSourceFields.handler({ table: "t1_prod" }, ctx());

    expect(result).toEqual([{ name: "dt", type: "DateTime64(6)" }]);
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).toBe("DESCRIBE TABLE remote(t1_prod_logs) FORMAT JSONEachRow");
  });

  it("get_source_fields rejects an injected table name without making any request", async () => {
    await expect(getSourceFields.handler({ table: "t1_logs), (SELECT * FROM system.users" }, ctx())).rejects.toThrow(
      /identifier/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("query appends the LIMIT cap before FORMAT", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse([]));

    await query.handler({ query: "SELECT dt FROM remote(t1_logs)", source_id: 1, table: "t1" }, ctx());

    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).toBe("SELECT dt FROM remote(t1_logs) LIMIT 500 FORMAT JSONEachRow");
  });

  it("query accepts WITH CTEs", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse([{ c: 1 }]));

    const result: any = await query.handler(
      { query: "WITH x AS (SELECT 1 AS c) SELECT * FROM x LIMIT 1", source_id: 1, table: "t1" },
      ctx(),
    );

    expect(result).toEqual([{ c: 1 }]);
  });

  it("query rejects writes without making any request", async () => {
    await expect(
      query.handler({ query: "ALTER TABLE t1 DELETE WHERE 1", source_id: 1, table: "t1" }, ctx()),
    ).rejects.toThrow(/SELECT|read-only/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
