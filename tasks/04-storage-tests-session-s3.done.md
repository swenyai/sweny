# Add S3 Session Store Tests

## Problem
`packages/providers/src/storage/session/s3.ts` has zero test coverage. It handles session load/save/list/append with S3 operations, JSONL transcript format, and pagination.

## Context
- Test directory: `packages/providers/tests/`
- Existing pattern: see `packages/providers/tests/storage-session.test.ts` for the FS session store tests — follow the same test structure
- The S3SessionStore class uses `@aws-sdk/client-s3` (GetObjectCommand, PutObjectCommand, ListObjectsV2Command)
- ESM spy limitation: cannot `vi.spyOn()` ESM module exports — use class-based mocks with `vi.mock()`

## Source File
`packages/providers/src/storage/session/s3.ts`

Key methods to test:
- `load(sessionId)` — GetObject, parse JSON, return PersistedSession or null on NoSuchKey
- `save(sessionId, session)` — PutObject with JSON serialized session
- `appendTranscript(sessionId, entry)` — GetObject existing JSONL, append new entry line, PutObject
- `listSessions(tenantId?, limit?, cursor?)` — ListObjectsV2 with prefix, pagination via ContinuationToken

## Test File to Create
`packages/providers/tests/storage-session-s3.test.ts`

## Mock Strategy
Mock `@aws-sdk/client-s3` S3Client.send method. Return appropriate responses for each command type. Test:
1. Load existing session (returns parsed JSON)
2. Load missing session (NoSuchKey error → returns null)
3. Save session (verify PutObject called with correct key and body)
4. Append transcript to existing session (verify JSONL format)
5. Append transcript to new session (NoSuchKey → creates new JSONL)
6. List sessions with pagination
7. List sessions with tenant prefix filter

## Verification
Run: `cd /Users/nate.ross/src/wickdninja/sweny && npm test --workspace=packages/providers`
All existing + new tests must pass.
