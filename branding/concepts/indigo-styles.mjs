// The round-7 drop (same outline, same rim arms, same slim centre drop) in six different lift styles,
// in a deep-indigo and white palette.
//   node branding/concepts/indigo-styles.mjs
// Writes branding/concepts/indigo-styles/<style>/app-icon.svg + app-icon-512.png, two standalone marks,
// and preview.html. Nothing in the live branding or the app is read or changed (only the drop outline is imported).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DROP, n } from '../shapes.mjs';
import { band, slimDrop } from './geometry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'indigo-styles');

// ── Palette: deep indigo blues and white ────────────────────────────────────────
const C = {
  night: '#080E2B', ink: '#0F1743', deep: '#1B2878', mid: '#2D3D9E', base: '#3A4DB0',
  bright: '#5468D4', light: '#7F93E6', soft: '#9BAEF5', mist: '#C4CCF0', pale: '#EEF1FF', white: '#FFFFFF',
};

// ── The round-7 shapes, unchanged ───────────────────────────────────────────
const RIM = band({ fo: 0.94, fi: 0.73, yO: 80, taper: true });
const SLIT = slimDrop(56, 176, 10);
const lowDrop = (d) => `M128 ${14 + d}C128 ${14 + d} 212 ${96 + d} 212 ${158 + d}A84 84 0 0 1 44 ${158 + d}C44 ${96 + d} 128 ${14 + d} 128 ${14 + d}Z`;

// ── SVG helpers ─────────────────────────────────────────────────────────────
const stop = ([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`;
const lin = (id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(stop).join('')}</linearGradient>`;
const rad = (id, stops, cx, cy, r) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(stop).join('')}</radialGradient>`;
const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const mask = (id, inner) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="300" height="300">${inner}</mask>`;
const cutMask = (p) => mask(`${p}-cut`, `<rect x="-20" y="-20" width="300" height="300" fill="#fff"/><path d="${SLIT}" fill="#000"/>`);

const place = (scale, ty, inner) => `<g transform="translate(${n(256 - 128 * scale)} ${ty}) scale(${scale})">${inner}</g>`;
const svg512 = (title, defs, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="MANA app icon"><title>${title}</title><defs>${defs}</defs>${inner}</svg>\n`;

/** The drop lifted off the page: a side wall, shadows, lighting on the face, rim arms and the cut. */
function lift3d(p, s) {
  const thick = s.thick ?? 8;
  const defs =
    lin(`${p}-face`, s.face, 0.2, 0, 0.8, 1) +
    lin(`${p}-bounce`, [[0.5, s.bounce[0], 0], [1, s.bounce[0], s.bounce[1]]]) +
    rad(`${p}-gloss`, [[0, '#FFFFFF', s.gloss], [1, '#FFFFFF', 0]], 0.3, 0.22, 0.5) +
    lin(`${p}-side`, s.side) +
    lin(`${p}-rim`, s.rim) +
    lin(`${p}-edge`, [[0, '#FFFFFF', 0.9], [0.5, '#FFFFFF', 0.12], [1, '#FFFFFF', 0]], 0.1, 0, 0.9, 1) +
    lin(`${p}-line`, s.lineStops ?? [[0, '#FFFFFF'], [1, '#DDE4FF']]) + blur(`${p}-b2`, 2.2) +
    blur(`${p}-b14`, 13) + blur(`${p}-b11`, 11) + blur(`${p}-b3`, 3) +
    cutMask(p) + mask(`${p}-sidem`, `<path d="${lowDrop(thick)}" fill="#fff"/>`);
  const body =
    (s.halo ? `<path d="${DROP}" fill="${s.halo[0]}" fill-opacity="${s.halo[1]}" transform="translate(0 6)" filter="url(#${p}-b14)"/>` : '') +
    (s.soft ? `<path d="${DROP}" fill="${s.shadow}" fill-opacity="0.5" transform="translate(0 26)" filter="url(#${p}-b11)"/>` : '') +
    (s.shadow ? `<path d="${DROP}" fill="${s.shadow}" fill-opacity="0.5" transform="translate(0 ${thick + 3})" filter="url(#${p}-b3)"/>` : '') +
    `<path d="${DROP}" fill="url(#${p}-side)" transform="translate(0 ${thick})"/>` +
    `<g mask="url(#${p}-sidem)"><path d="${SLIT}" fill="${s.groove[0]}" fill-opacity="${s.groove[1]}"/></g>` +
    `<g mask="url(#${p}-cut)">` +
    `<path d="${DROP}" fill="url(#${p}-face)"/><path d="${DROP}" fill="url(#${p}-bounce)"/><path d="${DROP}" fill="url(#${p}-gloss)"/>` +
    `</g>` +
    (s.whiteLine ? `<path d="${SLIT}" fill="${s.lineStops ? `url(#${p}-line)` : '#FFFFFF'}" fill-opacity="0.55" filter="url(#${p}-b2)"/><path d="${SLIT}" fill="url(#${p}-line)"/>` : '') +
    `<path d="${RIM}" fill="url(#${p}-rim)"/>` +
    `<path d="${DROP}" fill="none" stroke="url(#${p}-edge)" stroke-width="2.2" mask="url(#${p}-cut)"/>`;
  return { defs, body };
}

const GLASS = {
  face: [[0, C.soft], [0.45, '#4458CC'], [1, C.deep]],
  side: [[0, '#2B3AA0'], [1, '#0A1034']],
  rim: [[0, C.white], [1, C.mist]],
  bounce: ['#A9B8FF', 0.35], gloss: 0.8, groove: ['#04071A', 0.65], shadow: '#02040F',
};
const PEARL = {
  face: [[0, C.white], [0.55, '#E9EDFF'], [1, '#C6CFF3']],
  side: [[0, '#B4C0F2'], [1, '#34459F']],
  rim: [[0, C.light], [0.5, C.base], [1, C.deep]],
  bounce: ['#8FA2EA', 0.5], gloss: 0.8, groove: ['#141E5C', 0.55], shadow: '#050A2A',
};

// ── The six styles ──────────────────────────────────────────────────────────
const styles = [];

// 1 · Glass — a luminous indigo glass drop on a deep night tile
styles.push({
  id: '01-glass', name: '1 · Glass', blurb: 'A luminous indigo glass drop on a deep night-blue tile, with a soft glow and a few stars.',
  build() {
    const p = 's1';
    const d = lift3d(p, { ...GLASS, halo: [C.bright, 0.55] });
    const stars = [[70, 90, 1.6], [120, 58, 1.1], [402, 70, 1.8], [452, 132, 1.2], [60, 382, 1.4], [432, 404, 1.6], [472, 300, 1.1], [92, 204, 1.0]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity="0.55"/>`).join('');
    return svg512('MANA app icon — Glass',
      lin(`${p}-bg`, [[0, C.deep], [0.5, '#0C1442'], [1, '#060A22']], 0.2, 0, 0.8, 1) +
        rad(`${p}-glow`, [[0, C.bright, 0.42], [1, C.bright, 0]], 0.5, 0.55, 0.55) +
        rad(`${p}-sheen`, [[0, '#FFFFFF', 0.18], [1, '#FFFFFF', 0]], 0.5, 0, 0.8) + d.defs,
      `<rect width="512" height="512" fill="url(#${p}-bg)"/><rect width="512" height="512" fill="url(#${p}-glow)"/>` +
        `<rect width="512" height="512" fill="url(#${p}-sheen)"/>${stars}${place(1.3, 84, d.body)}`);
  },
});

// 1b · Glass, white line — the same as Glass, but the centre drop is a white inlay instead of a dark cut
styles.push({
  id: '01b-glass-white-line', name: '1b · Glass, white line', blurb: 'The Glass style with the centre drop in glowing white instead of a dark cut.',
  build() {
    const p = 's1b';
    const d = lift3d(p, { ...GLASS, halo: [C.bright, 0.55], whiteLine: true, groove: ['#04071A', 0] });
    const stars = [[70, 90, 1.6], [120, 58, 1.1], [402, 70, 1.8], [452, 132, 1.2], [60, 382, 1.4], [432, 404, 1.6], [472, 300, 1.1], [92, 204, 1.0]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity="0.55"/>`).join('');
    return svg512('MANA app icon — Glass, white line',
      lin(`${p}-bg`, [[0, C.deep], [0.5, '#0C1442'], [1, '#060A22']], 0.2, 0, 0.8, 1) +
        rad(`${p}-glow`, [[0, C.bright, 0.42], [1, C.bright, 0]], 0.5, 0.55, 0.55) +
        rad(`${p}-sheen`, [[0, '#FFFFFF', 0.18], [1, '#FFFFFF', 0]], 0.5, 0, 0.8) + d.defs,
      `<rect width="512" height="512" fill="url(#${p}-bg)"/><rect width="512" height="512" fill="url(#${p}-glow)"/>` +
        `<rect width="512" height="512" fill="url(#${p}-sheen)"/>${stars}${place(1.3, 84, d.body)}`);
  },
});

// 1c · Glass, warm line — 1b with a small warm glow at the foot of the centre line
const WARM_LINE = [[0, '#FFFFFF'], [0.5, '#FFFFFF'], [0.78, '#FFE2A8'], [1, '#FF7A45']];
styles.push({
  id: '01c-glass-warm-line', name: '1c · Glass, warm line', blurb: '1b with a small warm glow at the foot of the white centre line, like a spark of light on the drop.',
  build() {
    const p = 's1c';
    const d = lift3d(p, { ...GLASS, halo: [C.bright, 0.55], whiteLine: true, lineStops: WARM_LINE, groove: ['#04071A', 0] });
    const stars = [[70, 90, 1.6], [120, 58, 1.1], [402, 70, 1.8], [452, 132, 1.2], [60, 382, 1.4], [432, 404, 1.6], [472, 300, 1.1], [92, 204, 1.0]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity="0.55"/>`).join('');
    return svg512('MANA app icon — Glass, warm line',
      lin(`${p}-bg`, [[0, C.deep], [0.5, '#0C1442'], [1, '#060A22']], 0.2, 0, 0.8, 1) +
        rad(`${p}-glow`, [[0, C.bright, 0.42], [1, C.bright, 0]], 0.5, 0.55, 0.55) +
        rad(`${p}-sheen`, [[0, '#FFFFFF', 0.18], [1, '#FFFFFF', 0]], 0.5, 0, 0.8) + d.defs,
      `<rect width="512" height="512" fill="url(#${p}-bg)"/><rect width="512" height="512" fill="url(#${p}-glow)"/>` +
        `<rect width="512" height="512" fill="url(#${p}-sheen)"/>${stars}${place(1.3, 84, d.body)}`);
  },
});

// 2 · Pearl — a white pearl drop on a rich indigo tile
styles.push({
  id: '02-pearl', name: '2 · Pearl', blurb: 'A white pearl drop with indigo rim arms, lifted off a rich indigo tile.',
  build() {
    const p = 's2';
    const d = lift3d(p, { ...PEARL, soft: true });
    return svg512('MANA app icon — Pearl',
      lin(`${p}-bg`, [[0, C.light], [0.45, C.base], [1, C.deep]], 0.1, 0, 0.9, 1) +
        rad(`${p}-sheen`, [[0, '#FFFFFF', 0.45], [1, '#FFFFFF', 0]], 0.5, 0, 0.9) +
        lin(`${p}-vig`, [[0.55, '#0B1240', 0], [1, '#0B1240', 0.4]]) + d.defs,
      `<rect width="512" height="512" fill="url(#${p}-bg)"/>` +
        `<circle cx="448" cy="64" r="190" fill="#fff" fill-opacity="0.08"/>` +
        `<circle cx="56" cy="484" r="104" fill="${C.soft}" fill-opacity="0.16" stroke="#fff" stroke-opacity="0.14" stroke-width="2"/>` +
        `<rect width="512" height="512" fill="url(#${p}-sheen)"/><rect width="512" height="512" fill="url(#${p}-vig)"/>${place(1.3, 84, d.body)}`);
  },
});

// 3 · Emboss — soft, raised from the tile like moulded plastic
styles.push({
  id: '03-emboss', name: '3 · Emboss', blurb: 'One soft indigo material: the drop is pressed up out of the tile, and the centre drop is pressed in.',
  build() {
    const p = 's3';
    const defs =
      lin(`${p}-bg`, [[0, '#4659C4'], [1, '#33439F']], 0.1, 0, 0.9, 1) +
      lin(`${p}-face`, [[0, '#5D72DC'], [1, '#3446A8']], 0.2, 0, 0.8, 1) +
      lin(`${p}-rim`, [[0, C.white], [1, '#D5DCFA']]) +
      lin(`${p}-edge`, [[0, '#FFFFFF', 0.55], [0.5, '#FFFFFF', 0], [1, '#000000', 0.25]], 0.1, 0, 0.9, 1) +
      blur(`${p}-b8`, 7) + blur(`${p}-b10`, 9);
    const g =
      `<path d="${DROP}" fill="#FFFFFF" fill-opacity="0.32" transform="translate(-7 -8)" filter="url(#${p}-b8)"/>` +
      `<path d="${DROP}" fill="#0A1030" fill-opacity="0.55" transform="translate(8 12)" filter="url(#${p}-b10)"/>` +
      `<path d="${DROP}" fill="url(#${p}-face)"/>` +
      `<path d="${DROP}" fill="none" stroke="url(#${p}-edge)" stroke-width="2.4"/>` +
      `<path d="${RIM}" fill="url(#${p}-rim)" fill-opacity="0.93"/>` +
      `<path d="${SLIT}" fill="#FFFFFF" fill-opacity="0.3" transform="translate(0 2.6)"/>` +
      `<path d="${SLIT}" fill="#0F1A5E" fill-opacity="0.7"/>`;
    return svg512('MANA app icon — Emboss', defs,
      `<rect width="512" height="512" fill="url(#${p}-bg)"/>${place(1.3, 84, g)}`);
  },
});

// 4 · Float — the drop hovering well above a white tile, with a coloured glow and a small shadow below
styles.push({
  id: '04-float', name: '4 · Float', blurb: 'The drop hovers above a clean white tile. Its shadow is small and far below, so it feels lifted high.',
  build() {
    const p = 's4';
    const d = lift3d(p, { ...GLASS, thick: 5, shadow: null, halo: [C.bright, 0.4], bounce: ['#B4C2FF', 0.35], groove: [C.deep, 0.55] });
    return svg512('MANA app icon — Float',
      lin(`${p}-bg`, [[0, '#FFFFFF'], [1, '#E6EAFF']], 0.2, 0, 0.8, 1) +
        rad(`${p}-sheen`, [[0, C.mist, 0.5], [1, C.mist, 0]], 0.5, 0.35, 0.6) +
        blur(`${p}-g12`, 12) + blur(`${p}-g4`, 4) + d.defs,
      `<rect width="512" height="512" fill="url(#${p}-bg)"/><rect width="512" height="512" fill="url(#${p}-sheen)"/>` +
        `<ellipse cx="256" cy="448" rx="92" ry="13" fill="${C.mid}" fill-opacity="0.38" filter="url(#${p}-g12)"/>` +
        `<ellipse cx="256" cy="446" rx="54" ry="6" fill="${C.ink}" fill-opacity="0.4" filter="url(#${p}-g4)"/>` +
        place(1.2, 56, d.body));
  },
});

// 5 · Long shadow — flat colours with a long, fading diagonal shadow
styles.push({
  id: '05-long-shadow', name: '5 · Long shadow', blurb: 'Completely flat colours: a white drop, indigo arms, and one long diagonal shadow that fades into the tile.',
  build() {
    const p = 's5';
    const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    const near = rgb('#18226E'), far = rgb('#3A4AAA'), N = 54;
    let copies = '';
    for (let i = N; i >= 1; i--) copies += `<path d="${DROP}" fill="${hex(lerp(near, far, i / N))}" transform="translate(${n(i * 1.15)} ${n(i * 1.15)})"/>`;
    // the centre drop is cut through the face, so the shadow shows in it
    const cut = `<g mask="url(#${p}-cut)"><path d="${DROP}" fill="${C.white}"/></g>`;
    return svg512('MANA app icon — Long shadow',
      lin(`${p}-bg`, [[0, '#4F64D0'], [1, '#3445A5']], 0.1, 0, 0.9, 1) + cutMask(p),
      `<rect width="512" height="512" fill="url(#${p}-bg)"/>${place(1.3, 70, copies + cut + `<path d="${RIM}" fill="${C.base}"/>`)}`);
  },
});

// 6 · Liquid glass — a clear, frosted drop over soft coloured light
styles.push({
  id: '06-liquid-glass', name: '6 · Liquid glass', blurb: 'A clear frosted drop with a bright edge, floating over soft indigo light. The most modern look.',
  build() {
    const p = 's6';
    const defs =
      lin(`${p}-bg`, [[0, '#93A5F2'], [0.5, '#4257C8'], [1, '#1C2670']], 0.1, 0, 0.9, 1) +
      rad(`${p}-o1`, [[0, '#EAEEFF', 0.7], [1, '#EAEEFF', 0]], 0.5, 0.5, 0.5) +
      rad(`${p}-o2`, [[0, C.night, 0.6], [1, C.night, 0]], 0.5, 0.5, 0.5) +
      rad(`${p}-o3`, [[0, C.soft, 0.55], [1, C.soft, 0]], 0.5, 0.5, 0.5) +
      lin(`${p}-glass`, [[0, '#FFFFFF', 0.5], [0.5, '#FFFFFF', 0.18], [1, C.mist, 0.34]], 0.2, 0, 0.8, 1) +
      lin(`${p}-edge`, [[0, '#FFFFFF', 0.98], [0.55, '#FFFFFF', 0.35], [1, '#FFFFFF', 0.12]], 0.1, 0, 0.9, 1) +
      lin(`${p}-rim`, [[0, '#FFFFFF', 0.97], [1, '#E4E9FF', 0.6]]) +
      rad(`${p}-spec`, [[0, '#FFFFFF', 0.85], [1, '#FFFFFF', 0]], 0.5, 0.5, 0.5) +
      blur(`${p}-b12`, 11) + cutMask(p);
    const g =
      `<path d="${DROP}" fill="${C.night}" fill-opacity="0.38" transform="translate(0 20)" filter="url(#${p}-b12)"/>` +
      `<g mask="url(#${p}-cut)"><path d="${DROP}" fill="url(#${p}-glass)"/></g>` +
      `<path d="${RIM}" fill="url(#${p}-rim)"/>` +
      `<path d="${SLIT}" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="1.3"/>` +
      `<path d="${DROP}" fill="none" stroke="url(#${p}-edge)" stroke-width="3"/>` +
      `<ellipse cx="88" cy="86" rx="22" ry="7" fill="url(#${p}-spec)" transform="rotate(-52 88 86)"/>`;
    return svg512('MANA app icon — Liquid glass', defs,
      `<rect width="512" height="512" fill="url(#${p}-bg)"/>` +
        `<circle cx="150" cy="110" r="190" fill="url(#${p}-o1)"/><circle cx="430" cy="460" r="230" fill="url(#${p}-o2)"/>` +
        `<circle cx="440" cy="120" r="120" fill="url(#${p}-o3)"/>${place(1.3, 80, g)}`);
  },
});

// ── Standalone marks (transparent background) ─────────────────────────────────
function markSvg(title, spec, groundColour) {
  const p = 'mk';
  const d = lift3d(p, spec);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -4 296 316" width="256" height="272" role="img" aria-label="MANA mark"><title>${title}</title>` +
    `<defs>${d.defs}${blur('mk-ground', 6)}</defs>` +
    `<ellipse cx="128" cy="262" rx="62" ry="8" fill="${groundColour}" fill-opacity="0.3" filter="url(#mk-ground)"/>${d.body}</svg>\n`
  );
}

// ── Write everything ──────────────────────────────────────────────────────────
const put = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
for (const s of styles) {
  const svg = s.build();
  put(join(OUT, s.id, 'app-icon.svg'), svg);
  put(join(OUT, s.id, 'app-icon-512.png'), await sharp(Buffer.from(svg), { density: 288 }).resize(512, 512).png().toBuffer());
  console.log('wrote', s.id);
}
const markIndigo = markSvg('MANA mark — indigo glass', { ...GLASS }, '#02040F');
const markIndigoWhite = markSvg('MANA mark — indigo glass, white line', { ...GLASS, whiteLine: true, groove: ['#04071A', 0] }, '#02040F');
const markIndigoWarm = markSvg('MANA mark — indigo glass, warm line', { ...GLASS, whiteLine: true, lineStops: WARM_LINE, groove: ['#04071A', 0] }, '#02040F');
const markPearl = markSvg('MANA mark — white pearl', { ...PEARL }, '#050A2A');
put(join(OUT, 'mark-indigo.svg'), markIndigo);
put(join(OUT, 'mark-white.svg'), markPearl);
put(join(OUT, 'mark-indigo-warm-line.svg'), markIndigoWarm);
put(join(OUT, 'mark-indigo-warm-line-512.png'), await sharp(Buffer.from(markIndigoWarm), { density: 288 }).resize({ height: 512 }).png().toBuffer());
put(join(OUT, 'mark-indigo-white-line.svg'), markIndigoWhite);
put(join(OUT, 'mark-indigo-white-line-512.png'), await sharp(Buffer.from(markIndigoWhite), { density: 288 }).resize({ height: 512 }).png().toBuffer());
put(join(OUT, 'mark-indigo-512.png'), await sharp(Buffer.from(markIndigo), { density: 288 }).resize({ height: 512 }).png().toBuffer());
put(join(OUT, 'mark-white-512.png'), await sharp(Buffer.from(markPearl), { density: 288 }).resize({ height: 512 }).png().toBuffer());

// ── Preview ───────────────────────────────────────────────────────────────────
const card = (s) => `
  <div class="card"><h2>${s.name}</h2>
    <img class="sq" src="${s.id}/app-icon.svg" width="200" alt="">
    <div class="small"><img class="ci" src="${s.id}/app-icon.svg" width="72" alt=""><img class="sq" src="${s.id}/app-icon.svg" width="56" alt=""><img class="sq" src="${s.id}/app-icon.svg" width="40" alt=""><img class="sq" src="${s.id}/app-icon.svg" width="28" alt=""></div>
    <small>${s.blurb}</small></div>`;
writeFileSync(
  join(OUT, 'preview.html'),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MANA — indigo and white styles</title>
<style>
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; color:#0F1743; background:#F4F6FF; }
  main { max-width:1200px; margin:0 auto; padding:32px; }
  h1 { margin:0 0 4px; font-size:26px; } p { margin:0 0 18px; color:#475569; max-width:740px; }
  h3 { margin:34px 0 10px; font-size:13px; letter-spacing:1.4px; text-transform:uppercase; color:#2D3D9E; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
  .card { background:#fff; border:1px solid #DDE3FA; border-radius:18px; padding:20px; display:flex; flex-direction:column; align-items:center; gap:14px; }
  .card h2 { margin:0; font-size:15px; } .card small { color:#64748B; text-align:center; }
  .sq { border-radius:22.5%; box-shadow:0 10px 22px rgba(10,16,48,.28); } .ci { border-radius:50%; }
  .small { display:flex; gap:12px; align-items:flex-end; }
  .row { display:flex; flex-wrap:wrap; gap:16px; }
  .tile { border-radius:16px; padding:22px; display:flex; flex-direction:column; align-items:center; gap:10px; border:1px solid #DDE3FA; }
  .tile small { font-size:11px; opacity:.7; }
  .white { background:#fff; } .indigo { background:linear-gradient(135deg,#7F93E6,#3A4DB0 50%,#1B2878); color:#fff; } .night { background:#080E2B; color:#9BAEF5; } .mist { background:#EEF1FF; }
  .dock { display:flex; gap:12px; align-items:flex-end; padding:12px 16px; border-radius:26px; background:rgba(255,255,255,.7); border:1px solid #fff; box-shadow:0 8px 30px rgba(10,16,48,.12); width:max-content; max-width:100%; flex-wrap:wrap; }
  .dock img { border-radius:22.5%; box-shadow:0 6px 12px rgba(0,0,0,.2); }
  @media (max-width:900px){ .grid{ grid-template-columns:1fr; } }
</style></head><body><main>
<h1>MANA — indigo and white styles</h1>
<p>The round 7 logo (same drop, same arms, same centre drop) in six different lift styles, using only deep indigo blues and white. Nothing here is wired into the app yet.</p>
<div class="grid">${styles.map(card).join('')}</div>
<h3>On a dock</h3>
<div class="dock">${styles.map((s) => `<img src="${s.id}/app-icon.svg" width="64" alt="">`).join('')}</div>
<h3>Standalone marks</h3>
<div class="row">
  <div class="tile white"><img src="mark-indigo.svg" width="150" alt=""><small>mark-indigo · on white</small></div>
  <div class="tile mist"><img src="mark-indigo.svg" width="150" alt=""><small>on pale indigo</small></div>
  <div class="tile white"><img src="mark-indigo-white-line.svg" width="150" alt=""><small>mark-indigo-white-line · on white</small></div>
  <div class="tile white"><img src="mark-indigo-warm-line.svg" width="150" alt=""><small>mark-indigo-warm-line · on white</small></div>
  <div class="tile indigo"><img src="mark-white.svg" width="150" alt=""><small>mark-white · on indigo</small></div>
  <div class="tile night"><img src="mark-white.svg" width="150" alt=""><small>on night</small></div>
</div>
</main></body></html>
`,
);
console.log('wrote indigo-styles/preview.html');
