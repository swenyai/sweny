---
title: Supabase
description: Query, insert, update data and invoke edge functions on a Supabase project.
---

The Supabase skill gives Claude access to your Supabase project's data layer. Claude can query and modify rows through PostgREST, call database functions, invoke edge functions, and list auth users — useful for content pipelines, data sync workflows, and seeding test data.

## Metadata

| Field | Value |
|-------|-------|
| **ID** | `supabase` |
| **Category** | `general` |
| **Required env vars** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Optional env vars** | `SUPABASE_ALLOWED_TABLES`, `SUPABASE_ALLOWED_FUNCTIONS` |

## Tools

| Tool | Description |
|------|-------------|
| `supabase_query` | Query rows from a table with PostgREST filters, ordering, and limits |
| `supabase_count` | Count rows in a table, optionally with filters |
| `supabase_insert` | Insert or upsert rows into a table |
| `supabase_update` | Update rows matching filters (filters required) |
| `supabase_delete` | Delete rows matching filters (filters required) |
| `supabase_rpc` | Call a database function (stored procedure) |
| `supabase_invoke_function` | Invoke an edge function by name |
| `supabase_list_users` | List auth users (IDs, emails, metadata) |
| `supabase_list_tables` | List public tables with row counts |

## Setup

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Strongly recommended: bound what the agent can touch
export SUPABASE_ALLOWED_TABLES="games,profiles,course_modules"
export SUPABASE_ALLOWED_FUNCTIONS="get_table_counts,agent-gateway"
```

:::caution[High blast radius]
This skill runs with the **service role key**, which bypasses Row Level Security entirely. Every tool argument (table names, filters, function names) is model-controlled at runtime and can be influenced by content the agent reads. Treat this skill as full database access:

- Set `SUPABASE_ALLOWED_TABLES` and `SUPABASE_ALLOWED_FUNCTIONS` to restrict the agent to the tables and functions the workflow actually needs.
- Prefer a key with narrower scope over the service role key where your setup allows it.
- Never combine this skill with untrusted input sources unless the allowlists are configured.
:::

## Guardrails

Beyond the optional allowlists, the skill enforces:

- **Identifier validation** — table and function names must be bare identifiers; path traversal and query injection in names are rejected.
- **Filter encoding** — PostgREST filter values are URL-encoded, so a single filter string cannot smuggle additional query parameters.
- **Mandatory filters on writes** — `supabase_update` and `supabase_delete` require at least one filter to prevent accidental full-table modification.

## Workflow usage

**Content generation workflow:**
- **seed** — Insert generated content rows into staging tables
- **verify** — Query back inserted rows and validate counts

**Data sync workflow:**
- **extract** — Query source tables with filters
- **load** — Upsert transformed rows into destination tables
