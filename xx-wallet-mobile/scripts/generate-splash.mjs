#!/usr/bin/env node
/**
 * iOS splash screen generator — Phase C of the native-app-feel polish pass.
 *
 * iOS Safari shows an apple-touch-startup-image briefly when the user
 * taps the installed PWA's home-screen icon, while the JS bundle loads.
 * Without one, iOS falls back to a white flash that breaks the
 * launch-to-app continuity. With per-device-sized images, the launch
 * feels like one seamless animation from icon-tap to dashboard.
 *
 * Each splash:
 *   - ink-950 background (#0a0a0a) — matches App.tsx's loading state.
 *   - xx logo centered in brand teal (#08CDD7) — matches the
 *     brand/icon-color.svg used by the in-app loading state.
 *   - Logo at ~25% of shorter dimension. Sized to feel like a typical
 *     iOS native-app launch screen (Apple recommends "simple visual,
 *     not detailed branding"). Slightly larger than the in-app
 *     w-20 h-20 loading icon so the transition feels like a gentle
 *     shrink, not a jarring resize.
 *
 * Devices covered (current iPhone lineup + recent iPads, portrait only;
 * the manifest declares orientation: portrait so landscape splash
 * doesn't apply):
 *
 *   iPhone SE (3rd gen)         750×1334
 *   iPhone 14/15/16 (6.1")      1170×2532
 *   iPhone 14/15/16 Plus (6.7") 1284×2778
 *   iPhone 14/15/16 Pro (6.1")  1179×2556
 *   iPhone 14/15 Pro Max (6.7") 1290×2796
 *   iPhone 16 Pro (6.3")        1206×2622
 *   iPhone 16 Pro Max (6.9")    1320×2868
 *   iPad (10.9")                1620×2160
 *   iPad mini (8.3")            1488×2266
 *   iPad Air (11" / 13")        1640×2360
 *   iPad Pro 11" (M4)           1668×2388
 *   iPad Pro 13" (M4)           2048×2732
 *
 * Outputs into public/splash/.
 *
 * Also prints the index.html snippet with apple-touch-startup-image
 * link tags + media queries for each device, so the maintainer can
 * drop it straight into index.html.
 *
 * Usage (from xx-wallet-mobile/):
 *   node scripts/generate-splash.mjs
 *   # Then copy the printed HTML snippet into the <head> of index.html.
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const BG_INK_950 = '#0a0a0a';
const BRAND_TEAL = '#08CDD7';

/**
 * xx logo path data, copied from public/brand/icon-color.svg.
 * Inlined so this script doesn't depend on the source SVG file at
 * runtime. Brand mark is stable; if it ever changes we update here
 * and re-run the generator.
 */
const LOGO_PATHS = `
  <path d="M309.9,170.5c6,13.2,9.3,27.6,9.3,42.7c0,0.5,0.1,0.9,0.1,1.4l49.5-44v-52.5L309.9,170.5z"/>
  <path d="M303.5,213.3c0-52.4-46.9-95.1-104.5-95.1v39.2c35.2,0,63.9,23.9,65.2,53.7l-26.7,23.7c7.1,12.4,11.7,26.1,13.3,40.7l23.8-21.1c16.9,31.9,52.8,53.9,94.2,53.9v-39.2C332.8,269.1,303.5,244,303.5,213.3z"/>
  <path d="M301,381.5v-39.2c-36,0-65.3-25-65.3-55.8c0-52.4-46.9-95.1-104.5-95.1v39.2c30.6,0,56.3,18.1,63.3,42.4l-63.3,56.3v52.5l71.4-63.4C217,355.1,255.7,381.5,301,381.5z"/>
`;

/**
 * Device dimensions follow Apple's apple-touch-startup-image scheme.
 * width/height = physical pixels of the device screen.
 * cssWidth/cssHeight/dpr = CSS-pixel dimensions + device-pixel-ratio,
 * combined into the media query that iOS Safari matches against.
 */
const DEVICES = [
  // iPhone (current and recent)
  { name: 'iphone-se',            width: 750,  height: 1334, cssWidth: 375,  cssHeight: 667,  dpr: 2 },
  { name: 'iphone-14-15-16',      width: 1170, height: 2532, cssWidth: 390,  cssHeight: 844,  dpr: 3 },
  { name: 'iphone-14-15-16-plus', width: 1284, height: 2778, cssWidth: 428,  cssHeight: 926,  dpr: 3 },
  { name: 'iphone-14-15-pro',     width: 1179, height: 2556, cssWidth: 393,  cssHeight: 852,  dpr: 3 },
  { name: 'iphone-14-15-pro-max', width: 1290, height: 2796, cssWidth: 430,  cssHeight: 932,  dpr: 3 },
  { name: 'iphone-16-pro',        width: 1206, height: 2622, cssWidth: 402,  cssHeight: 874,  dpr: 3 },
  { name: 'iphone-16-pro-max',    width: 1320, height: 2868, cssWidth: 440,  cssHeight: 956,  dpr: 3 },

  // iPad (recent)
  { name: 'ipad',          width: 1620, height: 2160, cssWidth: 810,  cssHeight: 1080, dpr: 2 },
  { name: 'ipad-mini',     width: 1488, height: 2266, cssWidth: 744,  cssHeight: 1133, dpr: 2 },
  { name: 'ipad-air',      width: 1640, height: 2360, cssWidth: 820,  cssHeight: 1180, dpr: 2 },
  { name: 'ipad-pro-11',   width: 1668, height: 2388, cssWidth: 834,  cssHeight: 1194, dpr: 2 },
  { name: 'ipad-pro-13',   width: 2048, height: 2732, cssWidth: 1024, cssHeight: 1366, dpr: 2 },
];

/**
 * Compose a splash SVG: ink-950 background + brand-teal xx logo
 * centered. logoSizePx is the target visible width of the logo on
 * the splash. The logo's natural extent is ~50% of its 500-unit
 * viewBox, so the inner viewBox needs to be 2× the target logo size
 * for the logo to render at logoSizePx wide.
 */
function makeSplashSvg({ width, height, logoSizePx }) {
  const logoViewBox = logoSizePx * 2;
  const offsetX = (width - logoViewBox) / 2;
  const offsetY = (height - logoViewBox) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${BG_INK_950}"/>
    <svg x="${offsetX}" y="${offsetY}" width="${logoViewBox}" height="${logoViewBox}" viewBox="0 0 500 500" preserveAspectRatio="xMidYMid meet">
      <g fill="${BRAND_TEAL}">${LOGO_PATHS}</g>
    </svg>
  </svg>`;
}

async function main() {
  console.log('=== Generating iOS splash screens ===');
  await mkdir(resolve(REPO_ROOT, 'public/splash'), { recursive: true });

  for (const device of DEVICES) {
    const minDim = Math.min(device.width, device.height);
    const logoSizePx = Math.round(minDim * 0.25); // ~25% of shorter dim
    const svg = makeSplashSvg({
      width: device.width,
      height: device.height,
      logoSizePx,
    });
    const outPath = resolve(REPO_ROOT, `public/splash/${device.name}-portrait.png`);
    await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    console.log(
      `  ${outPath.replace(REPO_ROOT + '/', '')}  →  ${device.width}×${device.height}`
    );
  }

  console.log('\n=== HTML snippet for index.html ===');
  console.log(
    '<!-- iOS apple-touch-startup-image set. Generated by scripts/generate-splash.mjs.\n     Each splash matches a specific iPhone/iPad device + DPR + portrait orientation. -->'
  );
  for (const device of DEVICES) {
    const media = `(device-width: ${device.cssWidth}px) and (device-height: ${device.cssHeight}px) and (-webkit-device-pixel-ratio: ${device.dpr}) and (orientation: portrait)`;
    console.log(
      `<link rel="apple-touch-startup-image" href="/splash/${device.name}-portrait.png" media="${media}" />`
    );
  }
  console.log('\n=== done ===');
}

main().catch((err) => {
  console.error('generate-splash failed:', err);
  process.exit(1);
});
