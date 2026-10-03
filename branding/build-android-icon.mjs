// Builds the Android launcher icon from the same shapes as the logo files.
//   node branding/build-logos.mjs && node branding/build-android-icon.mjs
//
// Writes into apps/mobile/android/app/src/main/res:
//   - Adaptive icon (Android 8+): vector background + foreground, plus a monochrome layer that
//     Android 13+ tints for "themed icons". The launcher masks it to a circle / squircle / square.
//   - Legacy PNGs (Android 6–7, minSdk is 23): rounded-square and round, at every density.
// And a 512×512 PNG for the Play Store listing at branding/logo/mana-app-icon-512.png.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DROP, NAMAM_ARMS, NAMAM_DROP, P, n } from './shapes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, '..', 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res');
const ICON_SVG = join(HERE, 'logo', 'mana-app-icon.svg');
const PLAY_PNG = join(HERE, 'logo', 'mana-app-icon-512.png');

const put = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log('wrote', path.replace(join(HERE, '..') + '/', ''));
};

// ─── Adaptive icon (108 × 108 dp; the launcher guarantees only the centre 66 dp is visible) ──
// Same composition as mana-app-icon.svg (512 canvas → 108 viewport).
const K = 108 / 512;
const SCALE = 1.25 * K;
const TX = 96 * K;
const TY = 100 * K;

const argb = (hex, alpha) =>
  '#' + Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase() + hex.slice(1);

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n';
const VECTOR_OPEN =
  '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n' +
  '    xmlns:aapt="http://schemas.android.com/aapt"\n' +
  '    android:width="108dp"\n' +
  '    android:height="108dp"\n' +
  '    android:viewportWidth="108"\n' +
  '    android:viewportHeight="108">\n';

/** Android path data wants the same syntax as SVG; just make sure commas/spaces are tidy. */
const pd = (d) => d.replace(/([A-Za-z])/g, ' $1 ').replace(/\s+/g, ' ').trim();

const linear = (attr, { x1, y1, x2, y2, stops }) =>
  `    <aapt:attr name="android:${attr}">\n` +
  `      <gradient android:type="linear" android:startX="${n(x1)}" android:startY="${n(y1)}" android:endX="${n(x2)}" android:endY="${n(y2)}">\n` +
  stops.map(([o, c]) => `        <item android:offset="${o}" android:color="${c}"/>\n`).join('') +
  `      </gradient>\n` +
  `    </aapt:attr>\n`;

const circlePath = (cx, cy, r) =>
  `M${n(cx - r)},${n(cy)} a${n(r)},${n(r)} 0 1,0 ${n(2 * r)},0 a${n(r)},${n(r)} 0 1,0 ${n(-2 * r)},0 Z`;

function background() {
  const orbA = { cx: 448 * K, cy: 64 * K, r: 190 * K };
  const orbB = { cx: 56 * K, cy: 484 * K, r: 104 * K };
  return (
    XML_HEAD +
    VECTOR_OPEN +
    `  <path android:pathData="M0,0h108v108h-108z">\n` +
    linear('fillColor', {
      x1: 0, y1: 0, x2: 108, y2: 108,
      stops: [[0, P.waterLight], [0.45, P.water], [1, P.waterDeep]],
    }) +
    `  </path>\n` +
    `  <path android:fillColor="${argb('#FFFFFF', 0.1)}" android:pathData="${circlePath(orbA.cx, orbA.cy, orbA.r)}"/>\n` +
    `  <path android:fillColor="${argb(P.tealLight, 0.2)}" android:strokeColor="${argb('#FFFFFF', 0.14)}" android:strokeWidth="0.4" android:pathData="${circlePath(orbB.cx, orbB.cy, orbB.r)}"/>\n` +
    `</vector>\n`
  );
}

const GROUP_OPEN =
  `  <group\n` +
  `      android:translateX="${n(TX)}"\n` +
  `      android:translateY="${n(TY)}"\n` +
  `      android:scaleX="${Math.round(SCALE * 10000) / 10000}"\n` +
  `      android:scaleY="${Math.round(SCALE * 10000) / 10000}">\n`;

function foreground() {
  return (
    XML_HEAD +
    VECTOR_OPEN +
    GROUP_OPEN +
    // soft drop shadow, then the white droplet
    `    <group android:translateY="7">\n` +
    `      <path android:fillColor="${argb(P.waterInk, 0.2)}" android:pathData="${pd(DROP)}"/>\n` +
    `    </group>\n` +
    `    <path android:pathData="${pd(DROP)}">\n` +
    linear('fillColor', { x1: 77.6, y1: 14, x2: 178.4, y2: 242, stops: [[0, P.white], [1, P.waterPale]] }) +
    `    </path>\n` +
    // the namam: blue arms (a window onto the background) and the red line between them
    `    <path android:pathData="${pd(NAMAM_ARMS)}">\n` +
    linear('fillColor', { x1: 128, y1: 110, x2: 128, y2: 205, stops: [[0, P.water], [1, P.waterDeep]] }) +
    `    </path>\n` +
    `    <path android:fillColor="${P.namamRed}" android:pathData="${pd(NAMAM_DROP)}"/>\n` +
    `  </group>\n` +
    `</vector>\n`
  );
}

/** Themed-icon layer: one colour only (Android 13+ recolours it), so the droplet is an outline. */
function monochrome() {
  return (
    XML_HEAD +
    VECTOR_OPEN +
    GROUP_OPEN +
    `    <path android:pathData="${pd(DROP)}" android:strokeColor="#FF000000" android:strokeWidth="10" android:strokeLineJoin="round"/>\n` +
`    <path android:fillColor="#FF000000" android:pathData="${pd(NAMAM_ARMS)}"/>\n` +
    `    <path android:fillColor="#FF000000" android:pathData="${pd(NAMAM_DROP)}"/>\n` +
    `  </group>\n` +
    `</vector>\n`
  );
}

const ADAPTIVE =
  XML_HEAD +
  '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <background android:drawable="@drawable/ic_launcher_background"/>\n' +
  '    <foreground android:drawable="@drawable/ic_launcher_foreground"/>\n' +
  '    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>\n' +
  '</adaptive-icon>\n';

// These drawables use vector gradients (API 24+) and are only referenced by the API 26+
// adaptive icon, so they live in drawable-v26 and never get built for older Androids.
put(join(RES, 'drawable-v26', 'ic_launcher_background.xml'), background());
put(join(RES, 'drawable-v26', 'ic_launcher_foreground.xml'), foreground());
put(join(RES, 'drawable-v26', 'ic_launcher_monochrome.xml'), monochrome());
put(join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), ADAPTIVE);
put(join(RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), ADAPTIVE);

// ─── PNGs: legacy launcher icons + Play Store ────────────────────────────────
const svg = readFileSync(ICON_SVG);

async function raster(size, shape) {
  // Render large, then downscale — much cleaner than rasterising at 48 px directly.
  const img = sharp(svg, { density: 288 }).resize(size, size, { kernel: 'lanczos3' });
  if (shape === 'square') return img.png({ compressionLevel: 9 }).toBuffer();
  const mask =
    shape === 'round'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#fff"/></svg>`;
  return img
    .composite([{ input: Buffer.from(mask), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(DENSITIES)) {
  put(join(RES, `mipmap-${density}`, 'ic_launcher.png'), await raster(size, 'rounded'));
  put(join(RES, `mipmap-${density}`, 'ic_launcher_round.png'), await raster(size, 'round'));
}
put(PLAY_PNG, await raster(512, 'square'));
