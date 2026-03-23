# Task 03 — Worker Docker Build + Publish CI Workflow

## Goal

Create `.github/workflows/release-worker.yml` that builds the open-source worker Docker
image, pushes it to `ghcr.io/swenyai/worker`, and publishes a GitHub Release with SBOM
and provenance attestation — so `verify-build.sh` actually works.

## Background

`packages/worker/Dockerfile` exists and expects `dist/index.js`. The `verify-build.sh`
script references `https://github.com/swenyai/sweny/releases/tag/worker-<commit>` for
attestations. Without this workflow, that URL never exists and the audit path is broken.

The cloud worker runs on ECS Fargate ARM64 (2048 CPU / 4096 MB), so we need linux/arm64.
We also want linux/amd64 for dev machines. Multi-arch via Docker Buildx.

## Trigger

Push to `main` that modifies anything under `packages/worker/` (source or Dockerfile).
Also allow manual trigger (`workflow_dispatch`).

```yaml
on:
  push:
    branches: [main]
    paths:
      - "packages/worker/**"
      - "packages/shared/**"  # WorkerJobPayload type lives here
  workflow_dispatch:
```

## What the workflow must do

1. **Checkout** with `fetch-depth: 0` (for git rev-parse)
2. **Set up Docker Buildx** (multi-arch builder)
3. **Log in to GHCR** using `GITHUB_TOKEN`
4. **Build the worker dist** — run `npm ci` + `npm run build --workspace=packages/worker`
   inside the repo before Docker build, so `dist/` is available for `COPY dist/`
5. **Build and push multi-arch image**:
   - Platforms: `linux/amd64,linux/arm64`
   - Tags:
     - `ghcr.io/swenyai/worker:latest`
     - `ghcr.io/swenyai/worker:<short-sha>` (7-char git SHA)
   - Labels: standard OCI labels (org.opencontainers.image.*)
   - Push: yes
6. **Generate SBOM** with `anchore/sbom-action` → `worker-sbom.spdx.json`
7. **Create GitHub Release** tagged `worker-<short-sha>` with:
   - Auto-generated release notes
   - Attach `worker-sbom.spdx.json`
   - Body that includes the image digest (from buildx output)

## Permissions needed

```yaml
permissions:
  contents: write        # create releases
  packages: write        # push to ghcr.io
  id-token: write        # OIDC for provenance attestation
  attestations: write    # GitHub attestations
```

## Reference workflows in this repo

- `.github/workflows/release-action.yml` — builds the action Docker image, creates releases
- `.github/workflows/release.yml` — changeset-based npm release

## Key details

- The `Dockerfile` is at `packages/worker/Dockerfile` — set the Docker build context to
  the repo root (`.`) and the Dockerfile path with `-f packages/worker/Dockerfile` so
  that `COPY dist/ ./dist/` can reference `packages/worker/dist/`

  Wait — check the Dockerfile. It does `COPY dist/ ./dist/` which assumes the build
  context is `packages/worker/`. BUT the npm build outputs to `packages/worker/dist/`.
  Either: set context to `packages/worker/` (then npm build is outside context), or
  update the Dockerfile to use the right relative path. Recommend: build context =
  `packages/worker/`, copy dist there first.

  **Recommended approach**: before `docker buildx build`, run
  `cp -r packages/worker/dist packages/worker/.docker-dist` then use that as context.
  Actually simpler: just set context = `packages/worker/` since dist is already there
  after `npm run build --workspace=packages/worker`.

- Node version: 22 (matches existing CI)
- Use `docker/build-push-action@v6`
- Use `docker/login-action@v3` for GHCR login
- Use `docker/metadata-action@v5` for OCI labels + tag generation
- Use `docker/setup-buildx-action@v3`

## Acceptance criteria

- [ ] Workflow file exists at `.github/workflows/release-worker.yml`
- [ ] Triggers on `packages/worker/**` changes to main + `workflow_dispatch`
- [ ] Builds `linux/amd64` and `linux/arm64`
- [ ] Pushes `ghcr.io/swenyai/worker:latest` and `ghcr.io/swenyai/worker:<sha>`
- [ ] Creates GitHub Release tagged `worker-<sha>`
- [ ] Attaches SBOM to the release
- [ ] `verify-build.sh` will have a real URL to reference after this runs
