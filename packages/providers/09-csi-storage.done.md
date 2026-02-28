# CSI-compatible Kubernetes Storage Provider

Add `csiStorage` provider to `storage/` implementing `StorageProvider`.

- Uses Kubernetes PersistentVolumeClaim-backed storage via local file I/O on a mounted CSI volume
- Config: `basePath` (mount point of the PVC)
- Same file-based approach as fsStorage but semantically distinct for K8s deployments
- Works with any CSI driver (EBS, GCE PD, Azure Disk, Ceph, etc.)
