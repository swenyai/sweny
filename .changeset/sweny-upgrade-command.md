---
"@sweny-ai/core": minor
---

Add `sweny upgrade` (alias `sweny update`) to self-update the CLI. Detects the installing package manager (npm, pnpm, yarn, bun, volta, Homebrew) and runs the correct install command. Supports `--check` for dry-runs, `--force` for reinstalls, and `--tag` for non-default dist-tags (e.g. `beta`).

Also adds a passive "new version available" footer that prints once per command when a newer release is on npm. The check is cached 24 hours on disk, bounded to 1.5s, and suppressed in CI, non-TTY runs, or when `SWENY_NO_UPDATE_CHECK=1` / `SWENY_OFFLINE=1` is set.
