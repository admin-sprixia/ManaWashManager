// Logo concepts, kept apart from the live branding so nothing in the app changes until one is chosen.
//   node branding/concepts/concepts.mjs
// Writes branding/concepts/<id>/{mark,mark-dark,mark-mono,app-icon}.svg + app-icon-512.png and preview.html.
// The live files (branding/logo, shapes.mjs, the Android icon) are not read or written here.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DROP, P, n } from '../shapes.mjs';
import { atArc, band, contour, dropAt, glint, mirrorPt, slimDrop } from './geometry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const circle = (c, r, extra = '') => `<circle cx="${n(c[0])}" cy="${n(c[1])}" r="${n(r)}" ${extra}/>`;

// Each concept draws on top of the plain droplet. `draw(v)` returns the SVG for variant v
// ('light' | 'dark' | 'icon'); `cut` returns shapes to knock out of a one-colour droplet.
// Paint helpers: grad(id, stops) gives a url() fill and registers the gradient.

// ── A · Glass: light catching a real drop — rim light round the lower edge, a glint down the middle ──
const A = (() => {
  const rim = band({ fo: 0.93, fi: 0.78, yO: 84, taper: true });
  const shine = glint(128, 144, 15, 68);
  return {
    id: 'a-glass',
    name: 'A · Glass',
    blurb: 'A glossy drop: a rim of light along the lower edge and a vertical glint — the shine of a freshly washed car.',
    draw: (v, g) => {
      if (v === 'icon') {
        const rimFill = g('rim', [[0, P.water], [1, P.waterDeep]], 0, 0, 0, 1);
        const shineFill = g('shine', [[0, P.skyBright], [1, P.water]], 0, 0, 0, 1);
        return `<path d="${rim}" fill="${rimFill}"/><path d="${shine}" fill="${shineFill}"/>`;
      }
      const shineFill = v === 'dark' ? P.skyMist : g('shine', [[0, '#FFFFFF'], [1, P.skyMist]], 0, 0, 0, 1);
      return `<path d="${rim}" fill="#fff" fill-opacity="0.92"/><path d="${shine}" fill="${shineFill}"/>`;
    },
    cut: () => `<path d="${rim}"/><path d="${shine}"/>`,
  };
})();

// ── B · Foam: a drop of soap suds — bubbles that happen to follow the edge, and a rising stream ──
const B = (() => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const radius = (s) => Math.max(5, 13.5 - 0.05 * s);
  const poly = contour(0.76);
  const side = [];
  for (let s = 0; ; ) {
    const r = radius(s) * (0.9 + rand() * 0.2);
    const p = atArc(poly, s);
    if (!p || p[1] < 92) break;
    side.push({ p, r });
    s += r + radius(s + 16) + 1.5 + rand() * 3;
  }
  const arms = [...side, ...side.slice(1).map(({ p, r }) => ({ p: mirrorPt(p), r: r * (0.92 + rand() * 0.16) }))];
  const column = [];
  for (let y = 176, k = 0; k < 6; k++) {
    const r = [11, 8.6, 7.4, 6.4, 5.4, 4.4][k];
    column.push({ p: [128 + (rand() - 0.5) * 2, y], r });
    y -= r + [8.6, 7.4, 6.4, 5.4, 4.4, 0][k] + 1.8;
  }
  const placed = [...arms, ...column];
  // small stray bubbles fill the rest, like real foam
  const inside = (x, y) => Math.hypot(x - 128, y - 158) < 66 || (y < 158 && Math.abs(x - 128) < 8 + (y - 20) * 0.5);
  for (let tries = 0; tries < 900 && placed.length < arms.length + column.length + 26; tries++) {
    const x = 60 + rand() * 136, y = 52 + rand() * 180;
    const r = 1.6 + rand() * 3.2;
    if (!inside(x, y)) continue;
    if (placed.some((q) => Math.hypot(q.p[0] - x, q.p[1] - y) < q.r + r + 2.2)) continue;
    placed.push({ p: [x, y], r });
  }
  const all = placed;
  return {
    id: 'b-foam',
    name: 'B · Foam',
    blurb: 'Soap suds inside the drop, for the foam-wash side of the business.',
    draw: (v) => {
      const ink = v === 'icon' ? P.water : '#fff';
      return all
        .map(({ p, r }) => {
          const sw = Math.max(1.1, r * 0.19);
          const spec = r >= 6 ? circle([p[0] - r * 0.36, p[1] - r * 0.36], r * 0.2, `fill="${ink}" fill-opacity="0.95"`) : '';
          return circle(p, r - sw / 2, `fill="${ink}" fill-opacity="${v === 'icon' ? 0.14 : 0.2}" stroke="${ink}" stroke-width="${n(sw)}"`) + spec;
        })
        .join('');
    },
    cut: () => all.map(({ p, r }) => circle(p, r)).join(''),
  };
})();

// ── C · Ripples: a drop landing in water — three ripples round the base, the drop falling into them ──
const C = (() => {
  const rings = [
    { d: band({ fo: 0.91, fi: 0.82, yO: 96, taper: true }), o: 1 },
    { d: band({ fo: 0.74, fi: 0.67, yO: 132, taper: true }), o: 0.7 },
    { d: band({ fo: 0.57, fi: 0.5, yO: 164, taper: true }), o: 0.45 },
  ];
  const drop = slimDrop(46, 136, 9.5);
  return {
    id: 'c-ripples',
    name: 'C · Ripples',
    blurb: 'A drop falling into still water, with ripples spreading round it.',
    draw: (v, g) => {
      if (v === 'icon') {
        const f = g('rp', [[0, P.water], [1, P.waterDeep]], 0, 0, 0, 1);
        const df = g('rd', [[0, P.skyBright], [1, P.water]], 0, 0, 0, 1);
        return rings.map((r) => `<path d="${r.d}" fill="${f}" fill-opacity="${r.o}"/>`).join('') + `<path d="${drop}" fill="${df}"/>`;
      }
      const df = v === 'dark' ? P.skyMist : g('rd', [[0, '#FFFFFF'], [1, P.skyMist]], 0, 0, 0, 1);
      return rings.map((r) => `<path d="${r.d}" fill="#fff" fill-opacity="${r.o * 0.95}"/>`).join('') + `<path d="${drop}" fill="${df}"/>`;
    },
    cut: () => rings.map((r) => `<path d="${r.d}"/>`).join('') + `<path d="${drop}"/>`,
  };
})();

const CONCEPTS = [A, B, C];

// ── SVG wrappers ────────────────────────────────────────────────────────────
/** Collects gradient defs so each file stays self-contained, with ids unique per file. */
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

function mark(c, theme) {
  const idp = `${c.id}-${theme}`;
  const { defs, g } = gradients(idp);
  let body;
  if (theme === 'mono' || theme === 'mono-white') {
    const colour = theme === 'mono' ? P.waterInk : '#FFFFFF';
    body =
      `<mask id="${idp}-m"><rect width="256" height="256" fill="#fff"/><g fill="#000">${c.cut()}</g></mask>` +
      `<path d="${DROP}" fill="${colour}" mask="url(#${idp}-m)"/>`;
  } else {
    const stops = theme === 'dark'
      ? [[0, P.skyBright], [0.55, P.water], [1, '#0284C7']]
      : [[0, P.waterLight], [0.55, P.water], [1, P.waterDeep]];
    const fill = g('drop', stops, 0.2, 0, 0.8, 1);
    body = `<path d="${DROP}" fill="${fill}"/>${c.draw(theme, g)}`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="MANA mark">` +
    `<title>MANA mark — ${c.name}</title><defs>${defs.join('')}</defs>${body}</svg>\n`
  );
}

function appIcon(c) {
  const idp = `${c.id}-icon`;
  const { defs, g } = gradients(idp);
  const bg = g('bg', [[0, P.waterLight], [0.45, P.water], [1, P.waterDeep]], 0, 0, 1, 1);
  const dropFill = g('drop', [[0, '#FFFFFF'], [1, P.waterPale]], 0.2, 0, 0.8, 1);
  const art = c.draw('icon', g);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="MANA app icon">` +
    `<title>MANA app icon — ${c.name}</title><defs>${defs.join('')}</defs>` +
    `<rect width="512" height="512" fill="${bg}"/>` +
    `<circle cx="448" cy="64" r="190" fill="#fff" fill-opacity="0.10"/>` +
    `<circle cx="56" cy="484" r="104" fill="${P.tealLight}" fill-opacity="0.2" stroke="#fff" stroke-opacity="0.14" stroke-width="2"/>` +
    `<g transform="translate(96 100) scale(1.25)">` +
    `<path d="${DROP}" fill="${P.waterInk}" fill-opacity="0.2" transform="translate(0 7)"/>` +
    `<path d="${DROP}" fill="${dropFill}"/>${art}</g></svg>\n`
  );
}

const put = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

for (const c of CONCEPTS) {
  const dir = join(HERE, c.id);
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
const tiles = (dir, name, blurb) => `
<section>
  <h2>${name}</h2>
  <p class="note">${blurb}</p>
  <div class="row">
    <div class="tile light"><img src="${dir}/mark.svg" width="150" alt=""><small>light</small></div>
    <div class="tile dark"><img src="${dir}/mark-dark.svg" width="150" alt=""><small>dark</small></div>
    <div class="tile mist"><img src="${dir}/mark-mono.svg" width="150" alt=""><small>one colour</small></div>
    <div class="tile brand"><img src="${dir}/mark-mono-white.svg" width="150" alt=""><small>white on brand</small></div>
    <div class="tile mist"><div class="icons"><img class="sq" src="${dir}/app-icon.svg" width="132" alt=""><img class="ci" src="${dir}/app-icon.svg" width="132" alt=""></div><small>app icon</small></div>
    <div class="tile light"><div class="sizes"><img src="${dir}/mark.svg" width="48" alt=""><img src="${dir}/mark.svg" width="32" alt=""><img src="${dir}/mark.svg" width="24" alt=""><img src="${dir}/mark.svg" width="16" alt=""><img class="sq" src="${dir}/app-icon.svg" width="48" alt=""><img class="sq" src="${dir}/app-icon.svg" width="32" alt=""></div><small>small sizes</small></div>
  </div>
</section>`;

writeFileSync(
  join(HERE, 'preview.html'),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MANA logo concepts</title>
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
<header><h1>MANA — logo concepts</h1>
<p>Different takes on the MANA water-drop mark. Nothing here is wired into the app yet. The previous version is kept as <b>V1</b> for comparison.</p></header>
<main>
${tiles('v1-nested-drop', 'V1 · Nested drop (previous)', 'A drop inside a drop with a small drop at the centre. This is what branding/logo currently holds.').replaceAll('v1-nested-drop/mark.svg', 'v1-nested-drop/mana-mark.svg').replaceAll('v1-nested-drop/mark-dark.svg', 'v1-nested-drop/mana-mark-dark.svg').replaceAll('v1-nested-drop/mark-mono.svg', 'v1-nested-drop/mana-mark-mono.svg').replaceAll('v1-nested-drop/mark-mono-white.svg', 'v1-nested-drop/mana-mark-mono-white.svg').replaceAll('v1-nested-drop/app-icon.svg', 'v1-nested-drop/mana-app-icon.svg')}
${CONCEPTS.map((c) => tiles(c.id, c.name, c.blurb)).join('')}
</main><div style="height:56px"></div></body></html>
`,
);
console.log('wrote preview.html');
