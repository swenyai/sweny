import { existsSync } from "node:fs";
import type { StorageProvider } from "./types.js";
import { FsSessionStore } from "./session/fs.js";
import { FsMemoryStore } from "./memory/fs.js";
import { FsWorkspaceStore } from "./workspace/fs.js";

/**
 * Configuration for the CSI (Container Storage Interface) storage provider.
 *
 * This provider targets Kubernetes deployments where a PersistentVolumeClaim
 * is mounted into the pod. Because CSI drivers expose block or file storage
 * as a regular mount point, the underlying implementation reuses the
 * filesystem-based stores (`FsSessionStore`, `FsMemoryStore`,
 * `FsWorkspaceStore`).
 */
export interface CsiStorageConfig {
  /** Absolute path where the PVC is mounted, e.g. "/data/sweny". */
  mountPath: string;

  /** Optional human-readable volume name used for logging / identification. */
  volumeName?: string;

  /** Optional Kubernetes namespace, used for logging / identification. */
  namespace?: string;
}

/**
 * Creates a {@link StorageProvider} backed by a Kubernetes CSI volume.
 *
 * The factory validates that `mountPath` exists at creation time so
 * mis-configurations surface early rather than at first write.
 *
 * @example
 * ```ts
 * const storage = csiStorage({
 *   mountPath: "/data/sweny",
 *   volumeName: "sweny-pvc",
 *   namespace: "default",
 * });
 * const sessions = storage.createSessionStore();
 * ```
 */
export function csiStorage(config: CsiStorageConfig): StorageProvider {
  const { mountPath, volumeName, namespace } = config;

  if (!existsSync(mountPath)) {
    const ctx = [
      `mountPath="${mountPath}"`,
      volumeName ? `volume="${volumeName}"` : null,
      namespace ? `namespace="${namespace}"` : null,
    ]
      .filter(Boolean)
      .join(", ");

    throw new Error(
      `CSI mount path does not exist (${ctx}). Ensure the PersistentVolumeClaim is mounted before starting the application.`,
    );
  }

  return {
    createSessionStore: () => new FsSessionStore(mountPath),
    createMemoryStore: () => new FsMemoryStore(mountPath),
    createWorkspaceStore: () => new FsWorkspaceStore(mountPath),
  };
}
