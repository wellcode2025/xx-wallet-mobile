#!/usr/bin/env node
/**
 * PWA icon generator — Phase A of the native-app-feel polish pass.
 *
 * Rasterizes the brand-teal xx logo into the full PNG icon set the
 * manifest + apple-touch-icon + favicons reference. Reproducible from
 * the source SVG so changing the brand mark is a one-command rebuild.
 *
 * Outputs (relative to xx-wallet-mobile/):
 *   public/apple-touch-icon.png        180×180   full-bleed, iOS rounds the corners
 *   public/icons/icon-192.png          192×192   manifest any-purpose
 *   public/icons/icon-512.png          512×512   manifest any-purpose, high-res
 *   public/icons/icon-512-maskable.png 512×512   manifest maskable, logo well inside
 *                                                 the center 80% safe zone
 *   public/icons/favicon-16.png        16×16     browser tab fallback (PNG)
 *   public/icons/favicon-32.png        32×32     browser tab fallback (PNG)
 *
 * Design choices baked in:
 *   - Background = brand teal #08CDD7 (xx network media-kit primary).
 *   - Logo = white version (public/brand/icon-white.svg) for contrast
 *     against teal. Composited via a master-SVG template that scales the
 *     logo around the canvas center.
 *   - Logo occupies ~70% of canvas. Safely inside Android maskable's
 *     center-80% safe zone; visually balanced inside iOS's
 *     auto-rounded-square mask; reads cleanly at favicon-16 size.
 *   - No pre-rounded corners (iOS does that itself; pre-rounding would
 *     show a tiny visible square edge on Android).
 *
 * Usage (from xx-wallet-mobile/):
 *   npm install                            # picks up sharp if first run
 *   node scripts/generate-icons.mjs        # writes the eight PNGs
 *   # Then commit the outputs alongside this script.
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const BRAND_TEAL = '#08CDD7';

/**
 * The xx logo path data, copied verbatim from public/brand/icon-white.svg
 * so this script doesn't need to read + re-parse the file at run time.
 * Inlined because the brand mark is stable; if it ever changes we update
 * here and re-run the generator.
 */
const LOGO_PATHS = `
  <path d="M309.9,170.5c6,13.2,9.3,27.6,9.3,42.7c0,0.5,0.1,0.9,0.1,1.4l49.5-44v-52.5L309.9,170.5z"/>
  <path d="M303.5,213.3c0-52.4-46.9-95.1-104.5-95.1v39.2c35.2,0,63.9,23.9,65.2,53.7l-26.7,23.7c7.1,12.4,11.7,26.1,13.3,40.7l23.8-21.1c16.9,31.9,52.8,53.9,94.2,53.9v-39.2C332.8,269.1,303.5,244,303.5,213.3z"/>
  <path d="M301,381.5v-39.2c-36,0-65.3-25-65.3-55.8c0-52.4-46.9-95.1-104.5-95.1v39.2c30.6,0,56.3,18.1,63.3,42.4l-63.3,56.3v52.5l71.4-63.4C217,355.1,255.7,381.5,301,381.5z"/>
`;

/**
 * Compose a 500×500 master SVG: teal background + scaled white logo.
 * The transform scales the logo around the SVG center so it ends up at
 * the requested proportion of canvas regardless of its natural extent
 * inside the source viewBox.
 *
 * @param {number} logoCanvasPct  Target logo size as a fraction of canvas
 *                                 (0..1). 0.70 = logo occupies 70% of canvas.
 */
function makeMasterSvg({ logoCanvasPct, includeBackground = true }) {
  // Source logo natural extent within the 500-unit viewBox is ~50% wide,
  // so to land at logoCanvasPct of canvas we scale the inline logo by
  // (logoCanvasPct / 0.50).
  const LOGO_NATURAL_PCT = 0.50;
  const scale = logoCanvasPct / LOGO_NATURAL_PCT;
  const background = includeBackground
    ? `<rect width="500" height="500" fill="${BRAND_TEAL}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" preserveAspectRatio="xMidYMid meet">
    ${background}
    <g transform="translate(250 250) scale(${scale}) translate(-250 -250)" fill="#FFFFFF">
      ${LOGO_PATHS}
    </g>
  </svg>`;
}

/**
 * For the small favicons we want the COLOURED logo on transparent
 * (browser tab background dictates the surround), not white-on-teal.
 * This keeps "xx" recognisable in light-mode tab bars.
 */
function makeFaviconSvg({ logoCanvasPct }) {
  const LOGO_NATURAL_PCT = 0.50;
  const scale = logoCanvasPct / LOGO_NATURAL_PCT;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" preserveAspectRatio="xMidYMid meet">
    <g transform="translate(250 250) scale(${scale}) translate(-250 -250)" fill="${BRAND_TEAL}">
      ${LOGO_PATHS}
    </g>
  </svg>`;
}

async function rasterise(svgString, outPath, size) {
  await sharp(Buffer.from(svgString))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`  ${outPath.replace(REPO_ROOT + '/', '')}  →  ${size}×${size}`);
}

async function main() {
  console.log('=== Generating PWA icon set from brand SVG ===');

  await mkdir(resolve(REPO_ROOT, 'public/icons'), { recursive: true });

  // Apple touch icon — full-bleed, ~70% logo, no pre-rounding.
  // iOS doesn't mask aggressively (just rounds corners), so 70%
  // reads well on the iPhone home screen.
  const appleSvg = makeMasterSvg({ logoCanvasPct: 0.70 });
  await rasterise(appleSvg, resolve(REPO_ROOT, 'public/apple-touch-icon.png'), 180);

  // Manifest icons (any-purpose). 45% logo — dialed in across two
  // real-device test rounds. 70% (first pass) was clearly oversized.
  // 55% (second pass) still read large next to typical Android system
  // icons. 45% matches the visual weight of stock apps like Vivaldi
  // and feels intentional in the launcher grid. Logo still well
  // inside Android's 80% safe zone, teal background still extends
  // edge-to-edge for clean mask framing.
  const androidAnySvg = makeMasterSvg({ logoCanvasPct: 0.45 });
  await rasterise(androidAnySvg, resolve(REPO_ROOT, 'public/icons/icon-192.png'), 192);
  await rasterise(androidAnySvg, resolve(REPO_ROOT, 'public/icons/icon-512.png'), 512);

  // Maskable icon — same 45% logo. Composition identical to the
  // any-purpose icons so the install dialog and the home-screen
  // render look consistent regardless of which purpose the launcher
  // picks.
  const maskableSvg = makeMasterSvg({ logoCanvasPct: 0.45 });
  await rasterise(
    maskableSvg,
    resolve(REPO_ROOT, 'public/icons/icon-512-maskable.png'),
    512
  );

  // Favicons — teal logo on transparent. Small enough that the brand-teal
  // background-bleed treatment would muddy the mark at 16×16.
  const faviconSvg = makeFaviconSvg({ logoCanvasPct: 0.85 });
  await rasterise(faviconSvg, resolve(REPO_ROOT, 'public/icons/favicon-16.png'), 16);
  await rasterise(faviconSvg, resolve(REPO_ROOT, 'public/icons/favicon-32.png'), 32);

  console.log('\n=== done ===');
}

main().catch((err) => {
  console.error('generate-icons failed:', err);
  process.exit(1);
});
