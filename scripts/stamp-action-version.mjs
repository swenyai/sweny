#!/usr/bin/env node
// Stamp the `cli-version` default in action.yml to an exact @sweny-ai/core version.
// Used by the release workflow on the commit behind an immutable v5.<core-version> tag,
// so re-running that tag always installs the core it was cut with. The floating v5 tag
// is never stamped and keeps defaulting to "latest".
//
// usage: node scripts/stamp-action-version.mjs <version> [path/to/action.yml]
import { readFileSync, writeFileSync } from "node:fs";

const [version, file = "action.yml"] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  console.error(`stamp-action-version: expected an exact version, got "${version ?? ""}"`);
  process.exit(2);
}

const src = readFileSync(file, "utf8");
// The `default:` line directly under the top-level `cli-version:` input.
const re = /(^  cli-version:\n(?:    [^\n]*\n)*?    default: )"[^"\n]*"/m;
if (!re.test(src)) {
  console.error(`stamp-action-version: no cli-version default found in ${file}`);
  process.exit(1);
}
writeFileSync(file, src.replace(re, `$1"${version}"`));
console.log(`stamped ${file}: cli-version default = ${version}`);
