#!/usr/bin/env node
/**
 * Screenshot a built static Studio (CI only).
 *
 *   PW_DIR=<dir with playwright installed> node scripts/studio-screenshots.mjs <dist-dir> <out-dir> <label>
 *
 * Writes <out-dir>/<label>-<workflow>-<scheme>.png for triage and implement, dark and light.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const [distDir, outDir, label] = process.argv.slice(2);
if (!distDir || !outDir || !label) {
  console.error("usage: studio-screenshots.mjs <dist-dir> <out-dir> <label>");
  process.exit(2);
}
const pwDir = process.env.PW_DIR;
if (!pwDir) {
  console.error("PW_DIR must point at a directory with playwright installed");
  process.exit(2);
}
const { chromium } = createRequire(join(pwDir, "noop.js"))("playwright");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = normalize(join(distDir, urlPath));
  if (!file.startsWith(normalize(distDir))) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(distDir, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const scheme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: scheme });
    const page = await context.newPage();
    for (const workflow of ["triage", "implement"]) {
      await page.goto(base, { waitUntil: "networkidle" });
      if (workflow !== "triage") {
        await page.getByRole("button", { name: workflow, exact: true }).click();
      }
      await page.waitForSelector(".react-flow__edge", { timeout: 30000 });
      await page.waitForTimeout(1500);
      const file = join(outDir, `${label}-${workflow}-${scheme}.png`);
      await page.screenshot({ path: file });
      console.log(`wrote ${file}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
