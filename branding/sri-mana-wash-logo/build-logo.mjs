// Builds the Sri Mana Wash logo on its own, as on the front of the visiting card: the glass mark with
// its red centre drop, శ్రీ in gold and MANA WASH in Didot Bold. SVGs and transparent PNGs.
//   PYTHON=/path/to/python-with-fonttools node branding/sri-mana-wash-logo/build-logo.mjs
//
// Layouts: stacked (the mark over the name, like the card), in a line (mark, then the name), the name
// alone, and the mark alone. Colours: for dark backgrounds (white MANA WASH, light gold శ్రీ) and for
// light backgrounds (indigo MANA WASH, deep gold శ్రీ). Lettering is outlined, so no fonts are needed.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.PYTHON || 'python3';
const n = (v) => String(Math.round(v * 100) / 100);

const SUP = '/System/Library/Fonts/Supplemental';
const T = JSON.parse(
  execFileSync(PYTHON, [join(HERE, '../card/outline-text.py')], {
    input: JSON.stringify([
      { id: 'sri', font: `${SUP}/Telugu Sangam MN.ttc`, index: 1, text: 'శ్రీ', size: 100 },
      { id: 'name', font: `${SUP}/Didot.ttc`, index: 2, text: 'MANA WASH', size: 100, tracking: 0.12 },
    ]),
  }).toString(),
);

// ---------- the glass mark, red centre drop (as on the card) ----------
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
  'on-dark': { label: 'for dark backgrounds', name: '#FFFFFF', sri: 'url(#gold-light)' },
  'on-light': { label: 'for light backgrounds', name: '#1B2878', sri: 'url(#gold-deep)' },
};
const defs = `
<linearGradient id="gold-light" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFF1CF"/><stop offset="0.5" stop-color="#F8E2B0"/><stop offset="1" stop-color="#E8BF78"/>
</linearGradient>
<linearGradient id="gold-deep" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#D9A24A"/><stop offset="1" stop-color="#9A651F"/>
</linearGradient>`;

// ---------- the name: శ్రీ then MANA WASH, as on the card ----------
const CAP = T.name.bottom - T.name.top;
const SRI_H = CAP * 1.45; // శ్రీ stands a little taller than the capitals
const SRI_K = SRI_H / (T.sri.bottom - T.sri.top);
const SRI_W = T.sri.width * SRI_K;
const SRI_GAP = CAP * 0.37;
const NAME_W = SRI_W + SRI_GAP + T.name.width;

/** The name with its capitals' middle at `midY`, starting at `x`. */
function name(x, midY, t) {
  const baseY = midY - T.name.top - CAP / 2;
  const sriTop = midY - SRI_H / 2;
  return (
    `<path d="${T.sri.d}" transform="translate(${n(x)} ${n(sriTop - T.sri.top * SRI_K)}) scale(${n(SRI_K)})" fill="${t.sri}"/>` +
    `<path d="${T.name.d}" transform="translate(${n(x + SRI_W + SRI_GAP)} ${n(baseY)})" fill="${t.name}"/>`
  );
}

const PAD = CAP * 0.5;
const LAYOUTS = {
  /** The mark over the name, centred (the card's front). */
  stacked(t) {
    const dropH = CAP * 2.25;
    const gap = CAP * 0.57;
    const W = NAME_W + PAD * 2;
    const mid = PAD + dropH + gap + SRI_H / 2;
    return { W, H: mid + SRI_H / 2 + PAD, body: mark(W / 2, PAD, dropH) + name(PAD, mid, t) };
  },
  /** The mark, then the name, on one line. */
  horizontal(t) {
    const dropH = CAP * 2;
    const dropW = dropH / DROP_RATIO;
    const mid = PAD + dropH / 2;
    const x = PAD + dropW + CAP * 0.45;
    return { W: x + NAME_W + PAD, H: dropH + PAD * 2, body: mark(PAD + dropW / 2, PAD, dropH) + name(x, mid, t) };
  },
  /** శ్రీ MANA WASH alone. */
  name(t) {
    return { W: NAME_W + PAD * 2, H: SRI_H + PAD * 2, body: name(PAD, PAD + SRI_H / 2, t) };
  },
};

const outputs = [];
for (const [layout, build] of Object.entries(LAYOUTS)) {
  for (const [key, t] of Object.entries(THEMES)) {
    outputs.push({ file: `sri-mana-wash-${layout}-${key}`, label: `Sri Mana Wash logo, ${layout}, ${t.label}`, dark: key === 'on-dark', ...build(t) });
  }
}
// The mark alone works on any background.
{
  const dropH = CAP * 4;
  const dropW = dropH / DROP_RATIO;
  outputs.push({ file: 'sri-mana-wash-mark', label: 'Sri Mana Wash mark', dark: true, W: dropW + PAD * 2, H: dropH + PAD * 2, body: mark(PAD + dropW / 2, PAD, dropH) });
}

for (const o of outputs) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(o.W)} ${n(o.H)}" width="${n(o.W)}" height="${n(o.H)}" role="img" aria-label="${o.label}">
<title>${o.label}</title>
<defs>${defs}</defs>
${o.body}
</svg>
`;
  writeFileSync(join(HERE, `${o.file}.svg`), svg);
  // Transparent PNG, 3000 px across (the mark alone, 1200 px).
  const px = o.file.endsWith('mark') ? 1200 : 3000;
  await sharp(Buffer.from(svg), { density: (72 * px) / o.W }).resize(px).png().toFile(join(HERE, `${o.file}.png`));
  console.log('wrote', o.file);
}

// A preview: each logo on the background it's made for.
const tiles = await Promise.all(
  outputs.map(async (o) => {
    const png = await sharp(join(HERE, `${o.file}.png`)).resize(o.file.endsWith('mark') ? 220 : 800).toBuffer();
    const m = await sharp(png).metadata();
    return sharp({ create: { width: 900, height: m.height + 80, channels: 3, background: o.dark ? '#121A40' : '#F6F4EE' } })
      .composite([{ input: png, left: Math.round((900 - m.width) / 2), top: 40 }])
      .png()
      .toBuffer();
  }),
);
const heights = await Promise.all(tiles.map(async (b) => (await sharp(b).metadata()).height));
let y = 20;
const comps = [];
for (let i = 0; i < tiles.length; i += 2) {
  comps.push({ input: tiles[i], left: 20, top: y });
  if (tiles[i + 1]) comps.push({ input: tiles[i + 1], left: 940, top: y });
  y += Math.max(heights[i], heights[i + 1] ?? 0) + 20;
}
await sharp({ create: { width: 1860, height: y, channels: 3, background: '#D8DBE3' } })
  .composite(comps)
  .png()
  .toFile(join(HERE, 'sri-mana-wash-logo-preview.png'));
console.log('wrote sri-mana-wash-logo-preview.png');
