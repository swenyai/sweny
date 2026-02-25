export interface WorkspaceFile {
  path: string;
  blobId: string;
  size: number;
  mimeType: string;
  createdAt: string;
  description?: string;
}

export interface WorkspaceManifest {
  userId: string;
  createdAt: string;
  updatedAt: string;
  totalBytes: number;
  files: WorkspaceFile[];
}

export const WORKSPACE_LIMITS = {
  maxTotalBytes: 50 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxFiles: 500,
} as const;

export interface WorkspaceStore {
  getManifest(userId: string): Promise<WorkspaceManifest>;
  readFile(userId: string, path: string): Promise<string>;
  writeFile(userId: string, path: string, content: string, description?: string): Promise<WorkspaceFile>;
  deleteFile(userId: string, path: string): Promise<boolean>;
  reset(userId: string): Promise<void>;
  getDownloadUrl(userId: string, path: string): Promise<string>;
}
