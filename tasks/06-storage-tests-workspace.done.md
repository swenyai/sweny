# Add Workspace Store Tests (FS + S3)

## Problem
Both `packages/providers/src/storage/workspace/fs.ts` and `packages/providers/src/storage/workspace/s3.ts` have zero test coverage. These are the most complex storage implementations with quota enforcement, manifest management, blob storage, and MIME type detection.

## Context
- Test directory: `packages/providers/tests/`
- WorkspaceStore interface: getManifest, listFiles, writeFile, readFile, deleteFile
- WORKSPACE_LIMITS constant exported from `packages/providers/src/storage/constants.ts`:
  - maxTotalBytes: 50MB
  - maxFileBytes: 5MB
  - maxFiles: 500

## Source Files

### FS Workspace Store: `packages/providers/src/storage/workspace/fs.ts`
- Manifest at `{baseDir}/workspace/{userId}/manifest.json`
- Blobs at `{baseDir}/workspace/{userId}/blobs/{fileId}`
- Quota enforcement on write (total bytes, per-file bytes, file count)
- MIME type guessing from extension

### S3 Workspace Store: `packages/providers/src/storage/workspace/s3.ts`
- Manifest at `{prefix}/workspace/{userId}/manifest.json`
- Blobs at `{prefix}/workspace/{userId}/blobs/{fileId}`
- Same quota logic
- Presigned URL generation for readFile

## Test Files to Create

### `packages/providers/tests/storage-workspace-fs.test.ts`
Test with temp directory:
1. getManifest returns empty manifest for new user
2. writeFile creates blob + updates manifest
3. writeFile with metadata (MIME type, description)
4. listFiles returns all files in manifest
5. readFile returns file content as Buffer
6. readFile returns null for missing file
7. deleteFile removes blob + updates manifest
8. Quota: writeFile rejects file over maxFileBytes (5MB)
9. Quota: writeFile rejects when total would exceed maxTotalBytes
10. Quota: writeFile rejects when file count would exceed maxFiles

### `packages/providers/tests/storage-workspace-s3.test.ts`
Mock S3Client.send + getSignedUrl:
1. getManifest returns empty for missing key
2. writeFile puts blob + updates manifest
3. listFiles returns manifest files
4. readFile returns presigned URL (not blob content)
5. deleteFile removes blob + updates manifest
6. Quota enforcement (same 3 scenarios as FS)

## Verification
Run: `cd /Users/nate.ross/src/wickdninja/sweny && npm test --workspace=packages/providers`
All existing + new tests must pass.
