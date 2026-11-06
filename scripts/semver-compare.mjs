#!/usr/bin/env node
// Compare two SemVer 2.0.0 versions by precedence (https://semver.org/#spec-item-11):
// prereleases rank below their release, numeric identifiers compare numerically,
// build metadata is ignored. The release workflow uses it to never move v5 to a
// lower core; the tag job runs without node_modules, so no `semver` package here.
//
// usage: node scripts/semver-compare.mjs <a> <b>
// prints -1, 0 or 1 (a < b, a = b, a > b); exit 2 if either is not a SemVer version.

const NUM = "0|[1-9]\\d*";
const ID = `(?:${NUM}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const RE = new RegExp(
  `^(${NUM})\\.(${NUM})\\.(${NUM})(?:-(${ID}(?:\\.${ID})*))?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
);

function parse(v) {
  const m = RE.exec(v ?? "");
  if (!m) return null;
  return { core: [m[1], m[2], m[3]].map(BigInt), pre: m[4] === undefined ? [] : m[4].split(".") };
}

const sign = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

function compareIds(x, y) {
  const xn = /^\d+$/.test(x);
  const yn = /^\d+$/.test(y);
  if (xn && yn) return sign(BigInt(x), BigInt(y));
  if (xn !== yn) return xn ? -1 : 1; // numeric identifiers rank below alphanumeric ones
  return sign(x, y);
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    const c = sign(a.core[i], b.core[i]);
    if (c) return c;
  }
  if (!a.pre.length || !b.pre.length) return sign(b.pre.length, a.pre.length); // release > prerelease
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const c = compareIds(a.pre[i], b.pre[i]);
    if (c) return c;
  }
  return sign(a.pre.length, b.pre.length);
}

const [x, y] = process.argv.slice(2);
const a = parse(x);
const b = parse(y);
if (!a || !b) {
  console.error(`semver-compare: expected two SemVer versions, got "${x ?? ""}" and "${y ?? ""}"`);
  process.exit(2);
}
console.log(compare(a, b));
