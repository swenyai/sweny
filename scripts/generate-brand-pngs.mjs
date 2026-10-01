#!/usr/bin/env node

/**
 * Generates PNG brand assets from SVG sources.
 * Uses sharp (installed via @sweny-ai/web).
 *
 * Usage: node scripts/generate-brand-pngs.mjs
 */

import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
// Built first in CI (`npm run build --workspace=packages/core`); the tagline and palette come from the theme.
import { PALETTE, SWENY_TAGLINE } from "../packages/core/dist/theme.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const assetsDir = join(root, "assets");
const publicDir = join(root, "packages", "web", "public");

// Ensure output dir exists
mkdirSync(publicDir, { recursive: true });

// --- Favicon / App Icons ---
// Use the light icon (for dark bg) rendered on slate-800 background

const iconSvg = readFileSync(join(assetsDir, "logo-icon-light.svg"), "utf8");

// Parse viewBox to get aspect ratio
const vbMatch = iconSvg.match(/viewBox="([^"]+)"/);
const [, , , vbW, vbH] = vbMatch[1].split(" ").map(Number);

async function generateIcon(size, outputPath) {
  // Render icon centered on a slate-800 square with padding
  const padding = Math.round(size * 0.15);
  const iconH = size - padding * 2;
  const iconW = Math.round(iconH * (vbW / vbH));
  const iconX = Math.round((size - iconW) / 2);

  const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="#1e293b"/>
    <image href="data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}"
           x="${iconX}" y="${padding}" width="${iconW}" height="${iconH}"/>
  </svg>`;

  await sharp(Buffer.from(compositeSvg)).png().toFile(outputPath);
  console.log(`  ✓ ${outputPath}`);
}

// --- Social / OG Images ---

async function generateSocialImage(width, height, outputPath) {
  // Wordmark (SWE in text color, ny in brand blue, as in assets/logo-wordmark-*.svg) drawn as
  // centered text so it does not depend on the font's width, a blue accent rule, then the tagline
  // as two lines, on slate-800.
  const wmSize = Math.round(width * 0.075);
  const wmBase = Math.round(height * 0.42);

  // "Workflows for coding agents." / "One set of rules, a receipt for every run."
  const [lead, ...restParts] = SWENY_TAGLINE.split(/(?<=\.)\s+/);
  const rest = restParts.join(" ");
  const font = "system-ui, -apple-system, 'Helvetica Neue', sans-serif";
  const size = Math.round(width * 0.024);
  const ruleY = wmBase + Math.round(height * 0.08);
  const ruleW = Math.round(width * 0.08);
  const line1Y = ruleY + Math.round(size * 2);
  const line2Y = line1Y + Math.round(size * 1.5);

  const socialSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="${PALETTE.slate800}"/>
    <rect y="${height - 8}" width="${width}" height="8" fill="${PALETTE.blue500}"/>
    <text x="${width / 2}" y="${wmBase}" font-family="${font}" font-size="${wmSize}" font-weight="800"
          letter-spacing="-${(wmSize * 0.03).toFixed(1)}" text-anchor="middle"
          fill="${PALETTE.slate100}">SWE<tspan fill="${PALETTE.blue500}">ny</tspan></text>
    <rect x="${Math.round((width - ruleW) / 2)}" y="${ruleY}" width="${ruleW}" height="4" rx="2" fill="${PALETTE.blue500}"/>
    <text x="${width / 2}" y="${line1Y}" font-family="${font}" font-size="${size}" font-weight="600"
          fill="${PALETTE.slate100}" text-anchor="middle">${lead}</text>
    <text x="${width / 2}" y="${line2Y}" font-family="${font}" font-size="${size}"
          fill="${PALETTE.blue400}" text-anchor="middle">${rest}</text>
  </svg>`;

  await sharp(Buffer.from(socialSvg)).png().toFile(outputPath);
  console.log(`  ✓ ${outputPath}`);
}

async function main() {
  console.log("Generating brand PNGs...\n");

  console.log("App icons:");
  await generateIcon(180, join(publicDir, "apple-touch-icon.png"));
  await generateIcon(192, join(publicDir, "icon-192.png"));
  await generateIcon(512, join(publicDir, "icon-512.png"));

  console.log("\nSocial images:");
  await generateSocialImage(1200, 630, join(publicDir, "og-image.png"));
  await generateSocialImage(1200, 600, join(publicDir, "twitter-card.png"));
  await generateSocialImage(1280, 640, join(publicDir, "github-social.png"));

  console.log("\nDone! All PNGs generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
