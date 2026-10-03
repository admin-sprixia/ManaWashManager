// Builds the Android launcher icon from branding/android-icon/app-icon.svg (the source artwork).
//   node branding/build-android-icon.mjs
//
// The artwork uses blurred glows, shadows and masks, which Android vector drawables cannot express, so the
// adaptive icon's two image layers are rendered to PNG at every density. Writes into
// apps/mobile/android/app/src/main/res:
//   - Adaptive icon (Android 8+): mipmap-*/ic_launcher_background.png + ic_launcher_foreground.png (108 dp
//     layers; the launcher guarantees only the centre 66 dp is visible, and masks to circle / squircle / square),
//     plus a one-colour vector (drawable-v26/ic_launcher_monochrome.xml) that Android 13+ tints for themed icons.
//   - Legacy PNGs (Android 6–7, minSdk is 23): rounded-square and round, at every density.
// And writes the layers (background.svg, foreground.svg) and a 512×512 Play Store PNG into branding/android-icon/.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, '..', 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res');
const SRC_DIR = join(HERE, 'android-icon');
const SRC = join(SRC_DIR, 'app-icon.svg');

const put = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log('wrote', path.replace(join(HERE, '..') + '/', ''));
};

// ─── Split the source into a background layer and a foreground layer ────────────
const src = readFileSync(SRC, 'utf8');
const defs = src.match(/<defs>([\s\S]*?)<\/defs>/)[1];
const afterDefs = src.slice(src.indexOf('</defs>') + 7, src.lastIndexOf('</svg>'));
const groupAt = afterDefs.indexOf('<g transform="translate(');
if (groupAt < 0) throw new Error('app-icon.svg: could not find the drop group');
const backgroundArt = afterDefs.slice(0, groupAt); // tile, glow, stars
const dropArt = afterDefs.slice(groupAt).replace(/^<g transform="[^"]*">/, '').replace(/<\/g>$/, '');

// The drop in the 108 dp adaptive layer. Its height (with thickness) is 235 source units; this scale keeps
// that inside the 66 dp safe circle with room for the soft glow.
const K = 108 / 512;
const SCALE = 1.2 * K;
const DROP_CENTRE_Y = 131.5; // the drop spans y 14–249 in source units, including its thickness
const TX = 54 - 128 * SCALE;
const TY = 54 - DROP_CENTRE_Y * SCALE;

const svgOpen = (vb) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="108" height="108">`;
const backgroundSvg = `${svgOpen('0 0 512 512')}<defs>${defs}</defs>${backgroundArt}</svg>\n`;
const foregroundSvg =
  `${svgOpen('0 0 108 108')}<defs>${defs}</defs>` +
  `<g transform="translate(${TX.toFixed(3)} ${TY.toFixed(3)}) scale(${SCALE.toFixed(4)})">${dropArt}</g></svg>\n`;
put(join(SRC_DIR, 'background.svg'), backgroundSvg);
put(join(SRC_DIR, 'foreground.svg'), foregroundSvg);

// ─── Adaptive icon layers as PNGs, one per density ────────────────────────────
const LAYER_PX = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const renderSvg = (svg, px) => sharp(Buffer.from(svg), { density: (72 * px) / 108 * 2 }).resize(px, px, { kernel: 'lanczos3' });

for (const [density, px] of Object.entries(LAYER_PX)) {
  put(join(RES, `mipmap-${density}`, 'ic_launcher_background.png'), await renderSvg(backgroundSvg, px).flatten({ background: '#060A22' }).png({ compressionLevel: 9 }).toBuffer());
  put(join(RES, `mipmap-${density}`, 'ic_launcher_foreground.png'), await renderSvg(foregroundSvg, px).png({ compressionLevel: 9 }).toBuffer());
}

// Safe-zone check on the largest foreground: how far from the centre is anything clearly visible?
{
  const px = 432;
  const { data, info } = await renderSvg(foregroundSvg, px).raw().toBuffer({ resolveWithObject: true });
  const dpPerPx = 108 / px;
  let solid = 0, faint = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * info.channels + 3];
      const r = Math.hypot(x + 0.5 - px / 2, y + 0.5 - px / 2) * dpPerPx;
      if (a > 128) solid = Math.max(solid, r);
      if (a > 12) faint = Math.max(faint, r);
    }
  }
  console.log(`safe zone: solid art reaches ${solid.toFixed(1)} dp, soft glow ${faint.toFixed(1)} dp (circle is 33 dp, full layer 54 dp to the edge)`);
  if (solid > 33) throw new Error('artwork leaves the 66 dp safe zone');
}

// ─── One-colour layer for Android 13+ themed icons ─────────────────────────────
const pathOf = (fill) => {
  const m = src.match(new RegExp(`<path d="([^"]+)" fill="${fill.replace(/[()#]/g, '\\$&')}"`));
  if (!m) throw new Error(`app-icon.svg: no path filled ${fill}`);
  return m[1];
};
const pd = (d) => d.replace(/([A-Za-z])/g, ' $1 ').replace(/\s+/g, ' ').trim();
const DROP = pathOf('url(#s1b-face)');
const RIM = pathOf('url(#s1b-rim)');
const LINE = pathOf('url(#s1b-line)');

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n';
const monochrome =
  XML_HEAD +
  '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n' +
  '    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n' +
  `  <group\n      android:translateX="${TX.toFixed(3)}"\n      android:translateY="${TY.toFixed(3)}"\n      android:scaleX="${SCALE.toFixed(4)}"\n      android:scaleY="${SCALE.toFixed(4)}">\n` +
  `    <path android:pathData="${pd(DROP)}" android:strokeColor="#FF000000" android:strokeWidth="9" android:strokeLineJoin="round"/>\n` +
  `    <path android:fillColor="#FF000000" android:pathData="${pd(RIM)}"/>\n` +
  `    <path android:fillColor="#FF000000" android:pathData="${pd(LINE)}"/>\n` +
  `  </group>\n</vector>\n`;

const ADAPTIVE =
  XML_HEAD +
  '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <background android:drawable="@mipmap/ic_launcher_background"/>\n' +
  '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n' +
  '    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>\n' +
  '</adaptive-icon>\n';

put(join(RES, 'drawable-v26', 'ic_launcher_monochrome.xml'), monochrome);
put(join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), ADAPTIVE);
put(join(RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), ADAPTIVE);

// The earlier vector background and foreground are replaced by the PNG layers above.
for (const stale of ['ic_launcher_background.xml', 'ic_launcher_foreground.xml']) {
  const p = join(RES, 'drawable-v26', stale);
  if (existsSync(p)) {
    unlinkSync(p);
    console.log('removed', p.replace(join(HERE, '..') + '/', ''));
  }
}

// ─── Legacy launcher PNGs + Play Store ─────────────────────────────────────────
const iconSvg = Buffer.from(src);
async function raster(size, shape) {
  const img = sharp(iconSvg, { density: 288 }).resize(size, size, { kernel: 'lanczos3' });
  if (shape === 'square') return img.png({ compressionLevel: 9 }).toBuffer();
  const mask =
    shape === 'round'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#fff"/></svg>`;
  return img.composite([{ input: Buffer.from(mask), blend: 'dest-in' }]).png({ compressionLevel: 9 }).toBuffer();
}
const LEGACY_PX = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(LEGACY_PX)) {
  put(join(RES, `mipmap-${density}`, 'ic_launcher.png'), await raster(size, 'rounded'));
  put(join(RES, `mipmap-${density}`, 'ic_launcher_round.png'), await raster(size, 'round'));
}
put(join(SRC_DIR, 'play-store-512.png'), await raster(512, 'square'));
