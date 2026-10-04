// Logo concepts, round 3: in every option the middle line now runs up through the top edge of the drop,
// cutting the tip open. Round 1 (concepts.mjs and a-glass/, b-foam/, c-ripples/) is left as it was.
//   node branding/concepts/concepts-v2.mjs
// Writes branding/concepts/v3-glass/<id>/{mark,mark-dark,mark-mono,mark-mono-white,app-icon}.svg,
// app-icon-512.png and v3-glass/preview.html. Nothing in the live branding or the app is touched.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DROP, P, n } from '../shapes.mjs';
import { band } from './geometry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'v3-glass');

// The cut: a slit that starts above the drop (so it opens the tip) and runs down the middle.
const TOP = -4;
/** Straight-sided needle, half-width ht at the top and hb at the bottom, round bottom end at yBot. */
const needle = (ht, hb, yBot) =>
  `M${n(128 - ht)} ${TOP}L${n(128 + ht)} ${TOP}L${n(128 + hb)} ${n(yBot - hb)}` +
  `A${n(hb)} ${n(hb)} 0 0 1 ${n(128 - hb)} ${n(yBot - hb)}Z`;
/** A line that swells smoothly from a thin top to a rounded drop-shaped end. */
const swell = (ht, half, yBot) => {
  const yEnd = yBot - half;
  const right = `C${n(128 + ht)} ${n(yEnd * 0.5)} ${n(128 + half)} ${n(yEnd * 0.42)} ${n(128 + half)} ${n(yEnd)}`;
  const left = `C${n(128 - half)} ${n(yEnd * 0.42)} ${n(128 - ht)} ${n(yEnd * 0.5)} ${n(128 - ht)} ${TOP}`;
  return `M${n(128 - ht)} ${TOP}L${n(128 + ht)} ${TOP}${right}A${n(half)} ${n(half)} 0 0 1 ${n(128 - half)} ${n(yEnd)}${left}Z`;
};
/** A long four-point glint: flat thin top at the tip, widest at cy, point at the bottom. */
const longGlint = (ht, cy, rx, yBot) => {
  const kxT = ht * 0.8, kyT = (cy - TOP) * 0.16;
  const kx = rx * 0.16, ky = (yBot - cy) * 0.16;
  return (
    `M${n(128 - ht)} ${TOP}L${n(128 + ht)} ${TOP}` +
    `Q${n(128 + kxT)} ${n(cy - kyT)} ${n(128 + rx)} ${n(cy)}` +
    `Q${n(128 + kx)} ${n(cy + ky)} 128 ${n(yBot)}` +
    `Q${n(128 - kx)} ${n(cy + ky)} ${n(128 - rx)} ${n(cy)}` +
    `Q${n(128 - kxT)} ${n(cy - kyT)} ${n(128 - ht)} ${TOP}Z`
  );
};

// ── A · Glass ──────────────────────────────────────────────────────────────
const A = (() => {
  const rim = band({ fo: 0.94, fi: 0.73, yO: 80, taper: true });
  return {
    id: 'a-glass',
    name: 'A · Glass',
    blurb: 'A glossy drop with a rim of light along the lower edge and one long line that opens the tip. Round 3: a wider cut and thicker rim arms, so both hold up at small sizes.',
    slit: longGlint(5.4, 144, 17, 214),
    draw: (v, g) => {
      void g;
      return `<path d="${rim}" fill="${v === 'icon' ? 'url(#IDP-rim)' : '#fff'}" ${v === 'icon' ? '' : 'fill-opacity="0.92"'}/>`;
    },
    defs: (g) => ({ rim: g('rim', [[0, P.water], [1, P.waterDeep]]) }),
    cut: () => `<path d="${rim}"/>`,
  };
})();

const CONCEPTS = [A];

// ── SVG wrappers ────────────────────────────────────────────────────────────
function gradients(idp) {
  const defs = [];
  const g = (name, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => {
    const id = `${idp}-${name}`;
    defs.push(
      `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
        stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') +
        `</linearGradient>`,
    );
    return `url(#${id})`;
  };
  return { defs, g };
}

const maskDef = (idp, extra = '') =>
  `<mask id="${idp}-m" maskUnits="userSpaceOnUse" x="-20" y="-20" width="300" height="300">` +
  `<rect x="-20" y="-20" width="300" height="300" fill="#fff"/><g fill="#000"><path d="__SLIT__"/>${extra}</g></mask>`;

function mark(c, theme) {
  const idp = `${c.id}-${theme}`;
  const { defs, g } = gradients(idp);
  const mono = theme === 'mono' || theme === 'mono-white';
  const variant = theme === 'dark' ? 'dark' : 'light';
  if (!mono) c.defs(g, variant);
  const layers = mono ? '' : c.draw(variant).replaceAll('IDP', idp);
  const mask = maskDef(idp, mono ? c.cut() : '').replace('__SLIT__', c.slit);
  let fill;
  if (mono) fill = theme === 'mono' ? P.waterInk : '#FFFFFF';
  else {
    const stops = theme === 'dark'
      ? [[0, P.skyBright], [0.55, P.water], [1, '#0284C7']]
      : [[0, P.waterLight], [0.55, P.water], [1, P.waterDeep]];
    fill = g('drop', stops, 0.2, 0, 0.8, 1);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="MANA mark">` +
    `<title>MANA mark — ${c.name} (cut top)</title><defs>${defs.join('')}${mask}</defs>` +
    `<path d="${DROP}" fill="${fill}" mask="url(#${idp}-m)"/>${layers}</svg>\n`
  );
}

function appIcon(c) {
  const idp = `${c.id}-icon`;
  const { defs, g } = gradients(idp);
  const bg = g('bg', [[0, P.waterLight], [0.45, P.water], [1, P.waterDeep]], 0, 0, 1, 1);
  const dropFill = g('drop', [[0, '#FFFFFF'], [1, P.waterPale]], 0.2, 0, 0.8, 1);
  c.defs(g, 'icon');
  const art = c.draw('icon').replaceAll('IDP', idp);
  const mask = maskDef(idp).replace('__SLIT__', c.slit);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="MANA app icon">` +
    `<title>MANA app icon — ${c.name} (cut top)</title><defs>${defs.join('')}${mask}</defs>` +
    `<rect width="512" height="512" fill="${bg}"/>` +
    `<circle cx="448" cy="64" r="190" fill="#fff" fill-opacity="0.10"/>` +
    `<circle cx="56" cy="484" r="104" fill="${P.tealLight}" fill-opacity="0.2" stroke="#fff" stroke-opacity="0.14" stroke-width="2"/>` +
    `<g transform="translate(96 100) scale(1.25)">` +
    `<path d="${DROP}" fill="${P.waterInk}" fill-opacity="0.2" transform="translate(0 7)" mask="url(#${idp}-m)"/>` +
    `<path d="${DROP}" fill="${dropFill}" mask="url(#${idp}-m)"/>${art}</g></svg>\n`
  );
}

const put = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

for (const c of CONCEPTS) {
  const dir = join(OUT, c.id);
  put(join(dir, 'mark.svg'), mark(c, 'light'));
  put(join(dir, 'mark-dark.svg'), mark(c, 'dark'));
  put(join(dir, 'mark-mono.svg'), mark(c, 'mono'));
  put(join(dir, 'mark-mono-white.svg'), mark(c, 'mono-white'));
  const icon = appIcon(c);
  put(join(dir, 'app-icon.svg'), icon);
  put(join(dir, 'app-icon-512.png'), await sharp(Buffer.from(icon), { density: 288 }).resize(512, 512).png().toBuffer());
  console.log('wrote', c.id);
}

// ── Preview sheet ───────────────────────────────────────────────────────────
const tiles = (c) => `
<section>
  <h2>${c.name}</h2>
  <p class="note">${c.blurb}</p>
  <div class="row">
    <div class="tile light"><img src="${c.id}/mark.svg" width="150" alt=""><small>light</small></div>
    <div class="tile dark"><img src="${c.id}/mark-dark.svg" width="150" alt=""><small>dark</small></div>
    <div class="tile mist"><img src="${c.id}/mark-mono.svg" width="150" alt=""><small>one colour</small></div>
    <div class="tile brand"><img src="${c.id}/mark-mono-white.svg" width="150" alt=""><small>white on brand</small></div>
    <div class="tile mist"><div class="icons"><img class="sq" src="${c.id}/app-icon.svg" width="132" alt=""><img class="ci" src="${c.id}/app-icon.svg" width="132" alt=""></div><small>app icon</small></div>
    <div class="tile light"><div class="sizes"><img src="${c.id}/mark.svg" width="48" alt=""><img src="${c.id}/mark.svg" width="32" alt=""><img src="${c.id}/mark.svg" width="24" alt=""><img src="${c.id}/mark.svg" width="16" alt=""><img class="sq" src="${c.id}/app-icon.svg" width="48" alt=""><img class="sq" src="${c.id}/app-icon.svg" width="32" alt=""></div><small>small sizes</small></div>
  </div>
</section>`;

writeFileSync(
  join(OUT, 'preview.html'),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MANA logo concepts — round 3</title>
<style>
  :root { --ink:#0C4A6E; --deep:#0369A1; --mist:#E0F2FE; --night:#082F49; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; color:var(--ink); background:#F6FAFD; }
  header, main { max-width:1280px; margin:0 auto; padding:32px 32px 0; }
  h1 { margin:0 0 6px; font-size:26px; }
  header p, .note { margin:0 0 14px; color:#475569; max-width:760px; }
  h2 { margin:36px 0 4px; font-size:13px; letter-spacing:1.4px; text-transform:uppercase; color:var(--deep); }
  .row { display:grid; grid-template-columns:repeat(6,1fr); gap:12px; }
  .tile { border-radius:14px; border:1px solid #DBEAFE; padding:18px 10px 10px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; min-height:190px; }
  .tile small { font-size:11px; opacity:.7; }
  .light { background:#fff; } .dark { background:var(--night); color:#BAE6FD; border-color:#0b3a57; }
  .mist { background:var(--mist); } .brand { background:linear-gradient(135deg,#7DD3FC,#0EA5E9 45%,#0369A1); color:#fff; border-color:transparent; }
  .icons, .sizes { display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; justify-content:center; }
  .sq { border-radius:22.5%; } .ci { border-radius:50%; }
  @media (max-width:1000px){ .row{ grid-template-columns:repeat(3,1fr);} }
  @media (max-width:560px){ .row{ grid-template-columns:repeat(2,1fr);} }
</style></head><body>
<header><h1>MANA — Glass, round 3</h1>
<p>The Glass drop with a wider cut through the tip and thicker rim arms. Rounds 1 and 2 are untouched in the folders above. Nothing here is wired into the app yet.</p></header>
<main>
${CONCEPTS.map(tiles).join('')}
</main><div style="height:56px"></div></body></html>
`,
);
console.log('wrote v3-glass/preview.html');
