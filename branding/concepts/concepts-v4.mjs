// Round 4: the same Glass drop as round 3 (same shapes, same cut), now with depth — thickness, a soft
// lifted shadow, glass lighting and a richer tile, in the style of macOS dock icons.
//   node branding/concepts/concepts-v4.mjs
// Writes branding/concepts/v4-3d/{app-icon-3d-light,app-icon-3d-dark,mark-3d}.svg, 512 px PNGs and preview.html.
// Rounds 1–3 and the live branding are not read or written (only the shared drop outline is imported).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DROP, P, n } from '../shapes.mjs';
import { band } from './geometry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'v4-3d');

// ── The round-3 shapes, unchanged ────────────────────────────────────────────
const TOP = -4;
const RIM = band({ fo: 0.94, fi: 0.73, yO: 80, taper: true });
const SLIT = (() => {
  const ht = 5.4, cy = 144, rx = 17, yBot = 214;
  const kxT = ht * 0.8, kyT = (cy - TOP) * 0.16;
  const kx = rx * 0.16, ky = (yBot - cy) * 0.16;
  return (
    `M${n(128 - ht)} ${TOP}L${n(128 + ht)} ${TOP}` +
    `Q${n(128 + kxT)} ${n(cy - kyT)} ${n(128 + rx)} ${n(cy)}` +
    `Q${n(128 + kx)} ${n(cy + ky)} 128 ${n(yBot)}` +
    `Q${n(128 - kx)} ${n(cy + ky)} ${n(128 - rx)} ${n(cy)}` +
    `Q${n(128 - kxT)} ${n(cy - kyT)} ${n(128 - ht)} ${TOP}Z`
  );
})();

const THICK = 8; // how far the drop is lifted off the tile (its visible thickness)
/** The drop outline moved down by THICK, written out (used as a mask; clip paths and transforms are not reliable in every renderer). */
const DROP_LOW = `M128 ${14 + THICK}C128 ${14 + THICK} 212 ${96 + THICK} 212 ${158 + THICK}A84 84 0 0 1 44 ${158 + THICK}C44 ${96 + THICK} 128 ${14 + THICK} 128 ${14 + THICK}Z`;

const lin = (id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
  stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`).join('') +
  `</linearGradient>`;
const rad = (id, stops, cx, cy, r) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">` +
  stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`).join('') +
  `</radialGradient>`;
const blur = (id, sd) =>
  `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

/** Shared masks: the drop with the cut taken out, and the thickness layer's outline for clipping. */
const cutMask = (p) =>
  `<mask id="${p}-cut" maskUnits="userSpaceOnUse" x="-20" y="-20" width="300" height="300">` +
  `<rect x="-20" y="-20" width="300" height="300" fill="#fff"/><path d="${SLIT}" fill="#000"/></mask>` +
  `<mask id="${p}-sidem" maskUnits="userSpaceOnUse" x="-20" y="-20" width="300" height="300"><path d="${DROP_LOW}" fill="#fff"/></mask>`;

/** The lifted drop in the light style: pale glass face on a blue tile. */
function lightDrop(p) {
  return {
    defs:
      lin(`${p}-face`, [[0, '#FFFFFF'], [0.55, '#EAF6FD'], [1, '#C9E7F8']], 0.2, 0, 0.8, 1) +
      lin(`${p}-bounce`, [[0.55, '#7DD3FC', 0], [1, '#38BDF8', 0.5]]) +
      rad(`${p}-gloss`, [[0, '#FFFFFF', 0.95], [1, '#FFFFFF', 0]], 0.3, 0.2, 0.55) +
      lin(`${p}-side`, [[0, '#A9D8F3'], [1, '#2F7FB5']]) +
      lin(`${p}-rim`, [[0, P.skyBright], [0.5, P.water], [1, P.waterDeep]]) +
      lin(`${p}-edge`, [[0, '#FFFFFF', 0.95], [0.5, '#FFFFFF', 0.1], [1, '#FFFFFF', 0]], 0.1, 0, 0.9, 1) +
      blur(`${p}-b12`, 11) + blur(`${p}-b3`, 3) +
      cutMask(p),
    body:
      // soft lifted shadow, then a tight contact shadow
      `<path d="${DROP}" fill="#031F33" fill-opacity="0.5" transform="translate(0 26)" filter="url(#${p}-b12)"/>` +
      `<path d="${DROP}" fill="#031F33" fill-opacity="0.45" transform="translate(0 ${THICK + 3})" filter="url(#${p}-b3)"/>` +
      // thickness (the side wall) and the shaded groove where the cut shows it
      `<path d="${DROP}" fill="url(#${p}-side)" transform="translate(0 ${THICK})"/>` +
      `<g mask="url(#${p}-sidem)"><path d="${SLIT}" fill="#0C4A6E" fill-opacity="0.5"/></g>` +
      // the face, lit from the top-left, with sky light bouncing up from below
      `<g mask="url(#${p}-cut)">` +
      `<path d="${DROP}" fill="url(#${p}-face)"/>` +
      `<path d="${DROP}" fill="url(#${p}-bounce)"/>` +
      `<path d="${DROP}" fill="url(#${p}-gloss)" fill-opacity="0.8"/>` +
      `</g>` +
      `<path d="${RIM}" fill="url(#${p}-rim)"/>` +
      `<path d="${DROP}" fill="none" stroke="url(#${p}-edge)" stroke-width="2.2" mask="url(#${p}-cut)"/>`,
  };
}

/** The lifted drop in the glass style: a luminous blue drop, for dark tiles and as the standalone mark. */
function glassDrop(p, { halo = true } = {}) {
  return {
    defs:
      lin(`${p}-face`, [[0, '#8EDBFD'], [0.45, '#13A8EC'], [1, '#0369A1']], 0.2, 0, 0.8, 1) +
      lin(`${p}-bounce`, [[0.5, '#5EEAD4', 0], [1, '#5EEAD4', 0.4]]) +
      rad(`${p}-gloss`, [[0, '#FFFFFF', 0.85], [1, '#FFFFFF', 0]], 0.3, 0.22, 0.5) +
      lin(`${p}-side`, [[0, '#0B6BA3'], [1, '#04304C']]) +
      lin(`${p}-rim`, [[0, '#FFFFFF'], [1, '#BAE6FD']]) +
      lin(`${p}-edge`, [[0, '#FFFFFF', 0.9], [0.5, '#FFFFFF', 0.12], [1, '#FFFFFF', 0]], 0.1, 0, 0.9, 1) +
      blur(`${p}-b14`, 13) + blur(`${p}-b3`, 3) +
      cutMask(p),
    body:
      (halo ? `<path d="${DROP}" fill="#38BDF8" fill-opacity="0.55" transform="translate(0 6)" filter="url(#${p}-b14)"/>` : '') +
      `<path d="${DROP}" fill="#021827" fill-opacity="0.55" transform="translate(0 ${THICK + 3})" filter="url(#${p}-b3)"/>` +
      `<path d="${DROP}" fill="url(#${p}-side)" transform="translate(0 ${THICK})"/>` +
      `<g mask="url(#${p}-sidem)"><path d="${SLIT}" fill="#01121F" fill-opacity="0.65"/></g>` +
      `<g mask="url(#${p}-cut)">` +
      `<path d="${DROP}" fill="url(#${p}-face)"/>` +
      `<path d="${DROP}" fill="url(#${p}-bounce)"/>` +
      `<path d="${DROP}" fill="url(#${p}-gloss)"/>` +
      `</g>` +
      `<path d="${RIM}" fill="url(#${p}-rim)" fill-opacity="0.96"/>` +
      `<path d="${DROP}" fill="none" stroke="url(#${p}-edge)" stroke-width="2.2" mask="url(#${p}-cut)"/>`,
  };
}

// ── Tiles ───────────────────────────────────────────────────────────────────
const SCALE = 1.3;
const TX = 256 - 128 * SCALE; // 89.6
const TY = 84;
const place = (inner) => `<g transform="translate(${n(TX)} ${TY}) scale(${SCALE})">${inner}</g>`;
const head = (title, w, h, vb) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>`;

function iconLight() {
  const p = 'il';
  const d = lightDrop(p);
  return (
    head('MANA app icon — 3D, light tile', 512, 512, '0 0 512 512') +
    `<defs>` +
    lin(`${p}-bg`, [[0, '#8FD8FD'], [0.45, '#1FA9EE'], [1, '#0A5E9C']], 0.1, 0, 0.9, 1) +
    rad(`${p}-sheen`, [[0, '#FFFFFF', 0.5], [1, '#FFFFFF', 0]], 0.5, 0, 0.9) +
    lin(`${p}-vig`, [[0.55, '#03304F', 0], [1, '#03304F', 0.38]]) +
    d.defs +
    `</defs>` +
    `<rect width="512" height="512" fill="url(#${p}-bg)"/>` +
    `<circle cx="448" cy="64" r="190" fill="#fff" fill-opacity="0.09"/>` +
    `<circle cx="56" cy="484" r="104" fill="${P.tealLight}" fill-opacity="0.18" stroke="#fff" stroke-opacity="0.14" stroke-width="2"/>` +
    `<rect width="512" height="512" fill="url(#${p}-sheen)"/>` +
    `<rect width="512" height="512" fill="url(#${p}-vig)"/>` +
    place(d.body) +
    `</svg>\n`
  );
}

function iconDark() {
  const p = 'id';
  const d = glassDrop(p);
  return (
    head('MANA app icon — 3D, dark tile', 512, 512, '0 0 512 512') +
    `<defs>` +
    lin(`${p}-bg`, [[0, '#0F5283'], [0.5, '#073556'], [1, '#031A2E']], 0.2, 0, 0.8, 1) +
    rad(`${p}-glow`, [[0, '#38BDF8', 0.42], [1, '#38BDF8', 0]], 0.5, 0.55, 0.55) +
    rad(`${p}-sheen`, [[0, '#FFFFFF', 0.22], [1, '#FFFFFF', 0]], 0.5, 0, 0.8) +
    d.defs +
    `</defs>` +
    `<rect width="512" height="512" fill="url(#${p}-bg)"/>` +
    `<rect width="512" height="512" fill="url(#${p}-glow)"/>` +
    `<rect width="512" height="512" fill="url(#${p}-sheen)"/>` +
    place(d.body) +
    `</svg>\n`
  );
}

function mark3d() {
  const p = 'm3';
  const d = glassDrop(p, { halo: false });
  // room for the lift shadow below the drop
  return (
    head('MANA mark — 3D', 256, 292, '-20 -4 296 316') +
    `<defs>${d.defs}${blur(`${p}-ground`, 6)}</defs>` +
    `<ellipse cx="128" cy="262" rx="62" ry="8" fill="#031F33" fill-opacity="0.3" filter="url(#${p}-ground)"/>` +
    d.body +
    `</svg>\n`
  );
}

const put = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const png = async (svg, size) => sharp(Buffer.from(svg), { density: 288 }).resize(size, size).png().toBuffer();

const light = iconLight();
const dark = iconDark();
const mark = mark3d();
put(join(OUT, 'app-icon-3d-light.svg'), light);
put(join(OUT, 'app-icon-3d-dark.svg'), dark);
put(join(OUT, 'mark-3d.svg'), mark);
put(join(OUT, 'app-icon-3d-light-512.png'), await png(light, 512));
put(join(OUT, 'app-icon-3d-dark-512.png'), await png(dark, 512));
put(join(OUT, 'mark-3d-512.png'), await sharp(Buffer.from(mark), { density: 288 }).resize({ height: 512 }).png().toBuffer());
console.log('wrote v4-3d icons and mark');

writeFileSync(
  join(OUT, 'preview.html'),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MANA — 3D icons, round 4</title>
<style>
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; color:#0C4A6E; background:#F6FAFD; }
  header, main { max-width:1200px; margin:0 auto; padding:32px 32px 0; }
  h1 { margin:0 0 6px; font-size:26px; } p { margin:0 0 14px; color:#475569; max-width:760px; }
  h2 { margin:34px 0 10px; font-size:13px; letter-spacing:1.4px; text-transform:uppercase; color:#0369A1; }
  .row { display:flex; flex-wrap:wrap; gap:18px; align-items:flex-end; }
  .tile { border-radius:16px; border:1px solid #DBEAFE; padding:22px; display:flex; flex-direction:column; align-items:center; gap:12px; }
  .tile small { font-size:11px; opacity:.7; }
  .light { background:#fff; } .night { background:#0B1220; color:#94A3B8; border-color:#1f2a44; } .mist { background:#E0F2FE; }
  .sq { border-radius:22.5%; box-shadow:0 10px 24px rgba(3,31,51,.28); } .ci { border-radius:50%; }
  .dock { display:flex; gap:14px; align-items:flex-end; padding:12px 16px; border-radius:26px; background:rgba(255,255,255,.55); border:1px solid #fff; box-shadow:0 8px 30px rgba(3,31,51,.15); }
  .dock i { width:64px; height:64px; border-radius:22.5%; display:block; box-shadow:0 6px 12px rgba(0,0,0,.18); }
</style></head><body>
<header><h1>MANA — 3D icons, round 4</h1>
<p>The same Glass drop (same shape, same cut) with depth: a visible thickness, a soft lifted shadow, glass lighting and a richer tile. Round 3 is untouched. Nothing here is wired into the app yet.</p></header>
<main>
<h2>App icon</h2>
<div class="row">
  <div class="tile mist"><img class="sq" src="app-icon-3d-light.svg" width="220" alt=""><small>light tile</small></div>
  <div class="tile mist"><img class="sq" src="app-icon-3d-dark.svg" width="220" alt=""><small>dark tile</small></div>
  <div class="tile mist"><img class="ci" src="app-icon-3d-light.svg" width="140" alt=""><img class="ci" src="app-icon-3d-dark.svg" width="140" alt=""><small>round</small></div>
</div>
<h2>On a dock</h2>
<div class="dock">
  <i style="background:linear-gradient(#ff9a8b,#e0422f)"></i><i style="background:linear-gradient(#ffd66b,#f59e0b)"></i>
  <img class="sq" style="box-shadow:0 6px 12px rgba(0,0,0,.18)" src="app-icon-3d-light.svg" width="64" alt="">
  <img class="sq" style="box-shadow:0 6px 12px rgba(0,0,0,.18)" src="app-icon-3d-dark.svg" width="64" alt="">
  <i style="background:linear-gradient(#a7f3d0,#0d9488)"></i><i style="background:linear-gradient(#c4b5fd,#6d28d9)"></i>
</div>
<h2>Standalone mark</h2>
<div class="row">
  <div class="tile light"><img src="mark-3d.svg" width="170" alt=""><small>on white</small></div>
  <div class="tile mist"><img src="mark-3d.svg" width="170" alt=""><small>on light blue</small></div>
  <div class="tile night"><img src="mark-3d.svg" width="170" alt=""><small>on dark</small></div>
  <div class="tile light"><div class="row"><img src="mark-3d.svg" width="64" alt=""><img src="mark-3d.svg" width="40" alt=""><img src="mark-3d.svg" width="28" alt=""></div><small>small</small></div>
</div>
</main><div style="height:56px"></div></body></html>
`,
);
console.log('wrote v4-3d/preview.html');
