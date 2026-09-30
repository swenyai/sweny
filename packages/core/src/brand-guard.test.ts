import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Brand guard (#385): the brand color is blue. Indigo (Tailwind indigo-*, the
 * #6366f1 family) must not reappear in Studio, the docs site, or the README.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const targets = ["packages/studio/src", "packages/web/src", "README.md"];
const exts = new Set([".ts", ".tsx", ".css", ".md", ".mdx", ".astro", ".js", ".jsx", ".json", ".html"]);

// Tailwind indigo 50-950 hex values.
const indigoHex = [
  "eef2ff",
  "e0e7ff",
  "c7d2fe",
  "a5b4fc",
  "818cf8",
  "6366f1",
  "4f46e5",
  "4338ca",
  "3730a3",
  "312e81",
  "1e1b4b",
];
// Same shades as rgb triples.
const indigoRgb = [
  "238, ?242, ?255",
  "224, ?231, ?255",
  "199, ?210, ?254",
  "165, ?180, ?252",
  "129, ?140, ?248",
  "99, ?102, ?241",
  "79, ?70, ?229",
  "67, ?56, ?202",
  "55, ?48, ?163",
  "49, ?46, ?129",
  "30, ?27, ?75",
];
const banned = new RegExp(
  [
    `#(?:${indigoHex.join("|")})\\b`,
    `rgba?\\(\\s*(?:${indigoRgb.join("|")})\\b`,
    "\\bindigo\\b",
    "\\bindigo-\\d",
    "blueviolet",
  ].join("|"),
  "i",
);

function* walk(p: string): Generator<string> {
  const st = fs.statSync(p);
  if (st.isFile()) {
    if (exts.has(path.extname(p))) yield p;
    return;
  }
  for (const e of fs.readdirSync(p)) {
    if (e === "node_modules" || e === "dist" || e === ".astro") continue;
    yield* walk(path.join(p, e));
  }
}

describe("brand guard: no indigo", () => {
  it("finds no indigo hex, rgb, Tailwind class, prose, or blueviolet badge", () => {
    const hits: string[] = [];
    for (const t of targets) {
      for (const file of walk(path.join(root, t))) {
        fs.readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (banned.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });

  it("catches the patterns it is meant to (self-test)", () => {
    for (const s of ["#6366F1", "rgba(99,102,241,0.2)", "text-indigo-400", "renders in indigo", "badge-blueviolet?x"]) {
      expect(banned.test(s), s).toBe(true);
    }
    expect(banned.test("#3b82f6 rgba(59,130,246,0.2) text-blue-400")).toBe(false);
  });
});
