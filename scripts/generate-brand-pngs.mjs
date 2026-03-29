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

const wordmarkSvg = readFileSync(join(assetsDir, "logo-wordmark-light.svg"), "utf8");

async function generateSocialImage(width, height, outputPath) {
  // Wordmark centered, tagline below, on slate-800 background
  const wmW = Math.round(width * 0.4);
  const wmH = Math.round(wmW * (52 / 310)); // preserve aspect ratio from viewBox
  const wmX = Math.round((width - wmW) / 2);
  const wmY = Math.round(height * 0.35);

  const tagline = "Workflow orchestration for AI-powered engineering.";

  const socialSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#1e293b"/>
    <image href="data:image/svg+xml;base64,${Buffer.from(wordmarkSvg).toString("base64")}"
           x="${wmX}" y="${wmY}" width="${wmW}" height="${wmH}"/>
    <text x="${width / 2}" y="${wmY + wmH + 48}"
          font-family="system-ui, -apple-system, 'Helvetica Neue', sans-serif"
          font-size="${Math.round(width * 0.018)}" fill="#94a3b8"
          text-anchor="middle">${tagline}</text>
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
