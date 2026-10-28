// Builds the Sri Mana Wash T-shirt logo as SVGs and transparent PNGs (print-ready).
//   PYTHON=/path/to/python-with-fonttools node branding/tshirt/build-tshirt-logo.mjs
//
// శ్రీ in Ravi Prakash (a free OFL Telugu display face, in ./fonts with its licence) in glossy gold
// with a dark-amber outline, MANA WASH in Didot Bold, and the glass mark with its red centre drop.
// Two lockups: stacked (back print) and in a line (left chest). Each comes for dark shirts (white
// lettering), light shirts (indigo lettering), and flat two-colour (screen printing, no gradients).
// All lettering is outlined to paths, so the files print the same with no fonts installed.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.PYTHON || 'python3';
const n = (v) => String(Math.round(v * 100) / 100);

const DIDOT = '/System/Library/Fonts/Supplemental/Didot.ttc';
const T = JSON.parse(
  execFileSync(PYTHON, [join(HERE, '../card/outline-text.py')], {
    input: JSON.stringify([
      { id: 'sri', font: join(HERE, 'fonts/RaviPrakash-Regular.ttf'), index: 0, text: 'శ్రీ', size: 1000 },
      { id: 'name', font: DIDOT, index: 2, text: 'MANA WASH', size: 200, tracking: 0.14 },
    ]),
  }).toString(),
);

// ---------- the glass mark, red centre drop ----------
const markInner = readFileSync(join(HERE, '../concepts/indigo-styles/mark-indigo-white-line.svg'), 'utf8')
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title>.*?<\/title>/, '')
  .replace(/(<linearGradient id="mk-line"[^>]*>)[\s\S]*?(<\/linearGradient>)/, '$1<stop offset="0" stop-color="#F0483C"/><stop offset="1" stop-color="#B8141F"/>$2')
  .replace(/fill="#FFFFFF" fill-opacity="0.55" filter="url\(#mk-b2\)"/, 'fill="#FFFFFF" fill-opacity="0.7" filter="url(#mk-b2)"')
  .replace('<g mask="url(#mk-cut)">', '<g>');
/** The drop is 236 units tall (tip to base, with its edge) for 168 wide. */
const DROP_RATIO = 236 / 168;
function mark(cx, top, height) {
  const k = height / DROP_RATIO / 168;
  return `<svg x="${n(cx - 150 * k)}" y="${n(top - 14 * k)}" width="${n(300 * k)}" height="${n(300 * k)}" viewBox="-22 0 300 300" overflow="visible">${markInner}</svg>`;
}

// ---------- colours ----------
const THEMES = {
  dark: { label: 'for dark shirts', text: '#FFFFFF', sri: 'url(#gold)', outline: '#6B3305', glossy: true },
  light: { label: 'for light shirts', text: '#1B2878', sri: 'url(#gold)', outline: '#6B3305', glossy: true },
  flat: { label: 'flat two-colour, for screen printing', text: '#1B2878', sri: '#F2A51F', outline: '#8A4A0E', glossy: false },
};

const defs = `
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFF4B0"/><stop offset="0.35" stop-color="#FFD24A"/>
  <stop offset="0.7" stop-color="#F5A623"/><stop offset="1" stop-color="#E2701A"/>
</linearGradient>
<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.65"/><stop offset="0.42" stop-color="#FFFFFF" stop-opacity="0.08"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>`;

/** శ్రీ scaled to `height` of ink, its ink's top-left at (x, top): outline, gold, and a gloss on top. */
function sri(x, top, height, t) {
  const k = height / (T.sri.bottom - T.sri.top);
  const at = `transform="translate(${n(x)} ${n(top - T.sri.top * k)}) scale(${n(k)})"`;
  const stroke = n((height * 0.035) / k);
  return (
    `<path d="${T.sri.d}" ${at} fill="${t.outline}" stroke="${t.outline}" stroke-width="${stroke}" stroke-linejoin="round"/>` +
    `<path d="${T.sri.d}" ${at} fill="${t.sri}"/>` +
    (t.glossy ? `<path d="${T.sri.d}" ${at} fill="url(#gloss)"/>` : '')
  );
}
const sriWidth = (height) => T.sri.width * (height / (T.sri.bottom - T.sri.top));
const nameCap = T.name.bottom - T.name.top;

// ---------- lockups ----------
const PAD = 60;

/** Back print: శ్రీ big, MANA WASH beneath, centred. */
function stacked(t) {
  const sriH = 900;
  const sw = sriWidth(sriH);
  const nameScale = Math.min(1.6, (sw * 1.55) / T.name.width);
  const nw = T.name.width * nameScale;
  const W = Math.max(sw, nw) + PAD * 2;
  const gap = 70;
  const nameY = PAD + sriH + gap - T.name.top * nameScale;
  const H = nameY + T.name.bottom * nameScale + PAD;
  const body = `
${sri((W - sw) / 2, PAD, sriH, t)}
<path d="${T.name.d}" transform="translate(${n((W - nw) / 2)} ${n(nameY)}) scale(${n(nameScale)})" fill="${t.text}"/>`;
  return { W, H, body };
}

/** Left chest: the drop, శ్రీ and MANA WASH on one line, centred on the capitals. */
function inLine(t, withMark) {
  const capH = nameCap;
  const sriH = capH * 1.9;
  const dropH = capH * 2.0;
  const mid = PAD + dropH / 2;
  const dropW = dropH / DROP_RATIO;
  let x = PAD;
  let body = '';
  if (withMark) {
    body += mark(x + dropW / 2, mid - dropH / 2, dropH);
    x += dropW + capH * 0.45;
  }
  body += sri(x, mid - sriH / 2, sriH, t);
  x += sriWidth(sriH) + capH * 0.4;
  const baseY = mid - T.name.top - capH / 2;
  body += `<path d="${T.name.d}" transform="translate(${n(x)} ${n(baseY)})" fill="${t.text}"/>`;
  x += T.name.width;
  return { W: x + PAD, H: mid + dropH / 2 + PAD, body };
}

// ---------- files ----------
const outputs = [];
for (const [key, t] of Object.entries(THEMES)) {
  outputs.push({ file: `tshirt-logo-back-${key}`, label: `Sri Mana Wash T-shirt back logo, ${t.label}`, ...stacked(t) });
  outputs.push({ file: `tshirt-logo-chest-${key}`, label: `Sri Mana Wash T-shirt chest logo, ${t.label}`, ...inLine(t, key !== 'flat') });
}

for (const o of outputs) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(o.W)} ${n(o.H)}" width="${n(o.W)}" height="${n(o.H)}" role="img" aria-label="${o.label}">
<title>${o.label}</title>
<defs>${defs}</defs>
${o.body}
</svg>
`;
  writeFileSync(join(HERE, `${o.file}.svg`), svg);
  // Transparent PNG, 4000 px across: about 13 in wide at 300 dpi, enough for a back print.
  const scale = 4000 / o.W;
  await sharp(Buffer.from(svg), { density: 72 * scale })
    .resize(4000)
    .png()
    .withMetadata({ density: 300 })
    .toFile(join(HERE, `${o.file}.png`));
  console.log('wrote', o.file);
}

// One preview sheet: each logo on a dark and a light shirt colour.
const tiles = [];
for (const o of outputs) {
  const png = await sharp(join(HERE, `${o.file}.png`)).resize(900).toBuffer();
  const meta = await sharp(png).metadata();
  const bg = o.file.endsWith('dark') ? '#121826' : '#F4F1EA';
  tiles.push(
    await sharp({ create: { width: 1000, height: meta.height + 100, channels: 3, background: bg } })
      .composite([{ input: png, left: 50, top: 50 }])
      .png()
      .toBuffer(),
  );
}
const metas = await Promise.all(tiles.map((b) => sharp(b).metadata()));
const rows = [];
for (let i = 0; i < tiles.length; i += 2) rows.push([i, i + 1]);
const rowH = rows.map(([a, b]) => Math.max(metas[a].height, metas[b]?.height ?? 0));
const sheet = sharp({ create: { width: 2040, height: rowH.reduce((s, h) => s + h + 20, 20), channels: 3, background: '#DADDE5' } });
let y = 20;
const comps = [];
rows.forEach(([a, b], r) => {
  comps.push({ input: tiles[a], left: 20, top: y });
  if (tiles[b]) comps.push({ input: tiles[b], left: 1020, top: y });
  y += rowH[r] + 20;
});
await sheet.composite(comps).png().toFile(join(HERE, 'tshirt-logo-preview.png'));
console.log('wrote tshirt-logo-preview.png');
