---
"@sweny-ai/providers": patch
---

Fix `ERR_MODULE_NOT_FOUND` crash on import when optional peer deps are not installed. S3 storage classes (`S3SessionStore`, `S3MemoryStore`, `S3WorkspaceStore`) and `MCPClient` now lazy-load their peer dependencies (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@modelcontextprotocol/sdk`) on first use rather than at module load time. Also fixes a retry bug in `MCPClient` where a failed `connect()` would leave a stale client reference that blocked subsequent reconnect attempts.
