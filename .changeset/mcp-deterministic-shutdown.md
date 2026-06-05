---
"@sweny-ai/mcp": patch
---

Shut the MCP server down deterministically and never orphan a workflow child.

`index.ts` connected the stdio transport and returned, leaving cleanup to whatever the event loop happened to do after stdin closed. A client that exited or was force-killed mid-run could orphan the server plus its in-flight `sweny` workflow subprocess (re-parented to launchd/init), where it would keep running for up to the 10-minute workflow timeout long after the session that started it was gone.

The server now installs an explicit, idempotent shutdown: it traps `SIGINT`/`SIGTERM` and wires the transport's `onclose` (stdin EOF when the client disconnects) to terminate every active workflow child with `SIGTERM`, close the server, and exit. `run-workflow.ts` tracks in-flight children in a registry and exposes `terminateActiveWorkflows()` for the server to call.
