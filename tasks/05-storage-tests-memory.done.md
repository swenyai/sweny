# Add Memory Store Tests (FS + S3)

## Problem
Both `packages/providers/src/storage/memory/fs.ts` and `packages/providers/src/storage/memory/s3.ts` have zero test coverage. They handle user memory CRUD with caching.

## Context
- Test directory: `packages/providers/tests/`
- Follow existing test patterns from `storage-session.test.ts`
- MemoryStore interface: getMemories, addEntry, removeEntry, clearMemories

## Source Files

### FS Memory Store: `packages/providers/src/storage/memory/fs.ts`
- File-based storage at `{baseDir}/memory/{userId}.json`
- In-memory cache layer
- Methods: getMemories, addEntry (appends + cache update), removeEntry (filter by content), clearMemories

### S3 Memory Store: `packages/providers/src/storage/memory/s3.ts`
- S3-based storage at `{prefix}/memory/{userId}.json`
- In-memory cache layer
- Same interface as FS but with S3Client operations

## Test Files to Create

### `packages/providers/tests/storage-memory-fs.test.ts`
Test with temp directory (use `fs.mkdtemp`):
1. getMemories returns empty UserMemory for new user
2. addEntry appends a memory entry
3. addEntry multiple entries accumulate
4. removeEntry filters by content match
5. clearMemories removes all entries for user
6. getMemories reads from cache on second call (verify file not re-read)

### `packages/providers/tests/storage-memory-s3.test.ts`
Mock S3Client.send:
1. getMemories returns empty for missing key (NoSuchKey)
2. addEntry creates new memory file
3. addEntry appends to existing
4. removeEntry filters correctly
5. clearMemories deletes the S3 object
6. Cache behavior — second getMemories doesn't call S3 again

## Verification
Run: `cd /Users/nate.ross/src/wickdninja/sweny && npm test --workspace=packages/providers`
All existing + new tests must pass.
