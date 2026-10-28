// Builds the Sri Mana Wash shop name board (15 ft × 3 ft) as a print-ready SVG, full and half-scale
// PDFs, and a PNG preview: the glass mark and the name (శ్రీ MANA WASH on one line, శ్రీ in gold),
// with our two numbers and the proprietor on one small line along the bottom. Also the back of the
// board, in pearl like the visiting cards' backs: "Thank you" and VISIT AGAIN between the mark and
// శ్రీ MANA WASH.
//   PYTHON=/path/to/python-with-fonttools node branding/flex/actual-name-board/build-name-board.mjs
//
// Same look as the services board (branding/flex/services-flex-design): night indigo, gold, Didot and
// Avenir Next outlined to paths, the fine-line water ribbon. 1 unit = 1/300 ft (≈ 1.016 mm), so the
// board is 4500 × 900 units. The mark and the name centred, the details line beneath.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.PYTHON || 'python3';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const OWNER = 'Hrushikesh Vetagiri';
const PHONES = { primary: '91547 52999', secondary: '77802 76797' };

const W = 4500;
const H = 900;

const C = {
  night0: '#1B2878',
  night1: '#0C1442',
  night2: '#060A22',
  glow: '#5468D4',
  aqua: '#5EEAD4',
  white: '#FFFFFF',
  pale: '#E6EAFF',
  ink: '#141B47',
  indigo: '#2D3D9E',
  soft: '#9BAEF5',
  mist: '#DDE3FA',
  goldLight: '#F8E2B0',
  gold: '#E8BF78',
  goldDeep: '#CF9C52',
};

const n = (v) => String(Math.round(v * 100) / 100);

// ---------- lettering ----------
const SUP = '/System/Library/Fonts/Supplemental';
const DIDOT = `${SUP}/Didot.ttc`;
const AVENIR = '/System/Library/Fonts/Avenir Next.ttc';
const TELUGU = `${SUP}/Telugu Sangam MN.ttc`; // bold face, matching Didot's weight once scaled
const DIDOT_R = { font: DIDOT, index: 0 };
const DIDOT_I = { font: DIDOT, index: 1 };
const DIDOT_B = { font: DIDOT, index: 2 }; // bold: its thin strokes still read from across the road
const AV_BOLD = { font: AVENIR, index: 0 };
const AV_DEMI = { font: AVENIR, index: 2 };
const AV_MED = { font: AVENIR, index: 5 };

const NAME_SIZE = 345;
const NAME_TRACK = 0.12;

const TEXT = [
  { id: 'sri', font: TELUGU, index: 1, text: 'శ్రీ', size: 100 },
  { id: 'name', ...DIDOT_B, text: 'MANA WASH', size: NAME_SIZE, tracking: NAME_TRACK },
  { id: 'ownerLabel', ...AV_BOLD, text: 'PROPRIETOR', size: 40, tracking: 0.16 },
  { id: 'primaryLabel', ...AV_BOLD, text: 'PRIMARY', size: 40, tracking: 0.16 },
  { id: 'primary', ...AV_DEMI, text: PHONES.primary, size: 58, tracking: 0.03 },
  { id: 'secondaryLabel', ...AV_BOLD, text: 'SECONDARY', size: 40, tracking: 0.16 },
  { id: 'secondary', ...AV_DEMI, text: PHONES.secondary, size: 58, tracking: 0.03 },
  { id: 'owner', ...AV_DEMI, text: OWNER, size: 58, tracking: 0.02 },
  // the back
  { id: 'thanks', font: `${SUP}/SnellRoundhand.ttc`, index: 2, text: 'Thank you', size: 470 },
  { id: 'again', ...DIDOT_B, text: 'VISIT AGAIN', size: 150, tracking: 0.26 },
  { id: 'sriSmall', font: TELUGU, index: 1, text: 'శ్రీ', size: 100 },
  { id: 'manaSmall', ...DIDOT_B, text: 'MANA', size: 96, tracking: 0.16 },
  { id: 'washSmall', ...AV_DEMI, text: 'WASH', size: 46, tracking: 0.62 },
];
const T = JSON.parse(execFileSync(PYTHON, [join(HERE, '../../card/outline-text.py')], { input: JSON.stringify(TEXT) }).toString());

/** Outlined text. anchor: 'start' (x = left edge), 'middle' or 'end'. Baseline at y. */
const text = (id, x, y, fill, anchor = 'start') => {
  const left = anchor === 'middle' ? x - T[id].width / 2 : anchor === 'end' ? x - T[id].width : x;
  return `<path d="${T[id].d}" transform="translate(${n(left)} ${n(y)})" fill="${fill}"/>`;
};

// ---------- background ----------
/** A small seeded random, so the stars and bubbles sit in the same places every build. */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
const rand = seeded(11);
const STARS = Array.from({ length: 36 }, () => [rand() * W, 50 + rand() * (H - 100), 1.6 + rand() * 2.6, 0.25 + rand() * 0.5]);

const defs = `
<linearGradient id="bg" x1="0" y1="0" x2="0.12" y2="1">
  <stop offset="0" stop-color="${C.night0}"/><stop offset="0.55" stop-color="${C.night1}"/><stop offset="1" stop-color="${C.night2}"/>
</linearGradient>
<linearGradient id="bgx" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.night0}" stop-opacity="0.6"/><stop offset="0.5" stop-color="${C.night1}" stop-opacity="0"/><stop offset="1" stop-color="${C.night0}" stop-opacity="0.5"/>
</linearGradient>
${glow('glowA', 1000, 0.5, 0.2, C.glow, 0.55)}
${glow('glowB', 2250, 0.4, 0.4, C.glow, 0.45)}
${glow('glowC', 3500, 0.45, 0.24, C.glow, 0.3)}
${glow('glowAqua', 2250, 0.95, 0.48, C.aqua, 0.1)}
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.12"/><stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>
<linearGradient id="rib" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.glow}" stop-opacity="0.1"/><stop offset="0.2" stop-color="${C.soft}" stop-opacity="0.8"/>
  <stop offset="0.5" stop-color="${C.pale}" stop-opacity="0.55"/><stop offset="0.8" stop-color="${C.soft}" stop-opacity="0.8"/>
  <stop offset="1" stop-color="${C.glow}" stop-opacity="0.15"/>
</linearGradient>
<linearGradient id="pearl" x1="0" y1="0" x2="0.12" y2="1">
  <stop offset="0" stop-color="#FDFCF8"/><stop offset="1" stop-color="#EFEDE6"/>
</linearGradient>
<linearGradient id="ribPearl" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#9BAEF5" stop-opacity="0"/><stop offset="0.3" stop-color="#7F92DE" stop-opacity="0.8"/>
  <stop offset="0.7" stop-color="#7F92DE" stop-opacity="0.8"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/>
</linearGradient>
<linearGradient id="goldDeep" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#D2A250"/><stop offset="0.55" stop-color="#B07C2C"/><stop offset="1" stop-color="#8E5D1B"/>
</linearGradient>
<linearGradient id="glassGold" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FCE7AE"/><stop offset="0.45" stop-color="#E9BC5E"/><stop offset="0.8" stop-color="#C38A30"/><stop offset="1" stop-color="#9E681E"/>
</linearGradient>
<linearGradient id="glassGloss" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.75"/><stop offset="0.38" stop-color="#FFFFFF" stop-opacity="0.18"/><stop offset="0.46" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>
<linearGradient id="glassGoldDeep" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#E9C06A"/><stop offset="0.45" stop-color="#C9952F"/><stop offset="0.8" stop-color="#A06A1E"/><stop offset="1" stop-color="#7E4F14"/>
</linearGradient>
<linearGradient id="glassGlossSoft" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFF4D6" stop-opacity="0.55"/><stop offset="0.38" stop-color="#FFF4D6" stop-opacity="0.12"/><stop offset="0.46" stop-color="#FFF4D6" stop-opacity="0"/>
</linearGradient>
<linearGradient id="glassBase" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0.7" stop-color="#5A3508" stop-opacity="0"/><stop offset="1" stop-color="#5A3508" stop-opacity="0.28"/>
</linearGradient>
<linearGradient id="goldBright" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFF1CF"/><stop offset="0.5" stop-color="${C.goldLight}"/><stop offset="1" stop-color="${C.gold}"/>
</linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${C.goldLight}"/><stop offset="0.55" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDeep}"/>
</linearGradient>
<linearGradient id="goldH" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.goldDeep}"/><stop offset="0.5" stop-color="${C.goldLight}"/><stop offset="1" stop-color="${C.goldDeep}"/>
</linearGradient>
`;

/** The twisting fine-line water ribbon from the card, stretched along the whole board. */
/** A soft radial light, stretched to the board's shape. */
function glow(id, cx, cy, r, color, opacity) {
  const fx = n(cx / W);
  return `<radialGradient id="${id}" cx="${fx}" cy="${cy}" r="${r}" gradientTransform="translate(${fx} ${cy}) scale(1 ${n(W / H)}) translate(-${fx} -${cy})">
  <stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
</radialGradient>`;
}

function ribbon({ y0, amp, width, lines = 34, waves = 3.2, phase = 0, stroke = 'rib', opacity = 0.45 }) {
  const paths = [];
  for (let i = 0; i < lines; i++) {
    const t = i / (lines - 1) - 0.5;
    let d = '';
    for (let x = -40; x <= W + 40; x += 40) {
      const u = x / W;
      const centre = y0 + amp * Math.sin(u * Math.PI * waves + phase);
      const spread = width * (0.2 + 0.8 * Math.abs(Math.cos(u * Math.PI * waves * 0.72 + phase * 0.6)));
      const y = centre + t * spread + 14 * Math.sin(u * Math.PI * waves * 2 + t * 2);
      d += `${x === -40 ? 'M' : 'L'}${n(x)} ${n(y)}`;
    }
    const edge = 1 - Math.abs(t) * 1.4;
    paths.push(`<path d="${d}" stroke-opacity="${n(0.3 + 0.6 * edge)}"/>`);
  }
  return `<g fill="none" stroke="url(#${stroke})" stroke-width="2.2" stroke-linecap="round" opacity="${opacity}">${paths.join('')}</g>`;
}

/** A four-point sparkle. */
const sparkle = (x, y, s, fill = C.goldLight, opacity = 1) =>
  `<path d="M${n(x)} ${n(y - s)}C${n(x + s * 0.12)} ${n(y - s * 0.12)} ${n(x + s * 0.12)} ${n(y - s * 0.12)} ${n(x + s)} ${n(y)}C${n(x + s * 0.12)} ${n(y + s * 0.12)} ${n(x + s * 0.12)} ${n(y + s * 0.12)} ${n(x)} ${n(y + s)}C${n(x - s * 0.12)} ${n(y + s * 0.12)} ${n(x - s * 0.12)} ${n(y + s * 0.12)} ${n(x - s)} ${n(y)}C${n(x - s * 0.12)} ${n(y - s * 0.12)} ${n(x - s * 0.12)} ${n(y - s * 0.12)} ${n(x)} ${n(y - s)}Z" fill="${fill}" fill-opacity="${opacity}"/>`;

const diamond = (x, y, s, fill = C.soft) => `<path d="M${n(x)} ${n(y - s)}l${n(s * 0.75)} ${n(s)}l${n(-s * 0.75)} ${n(s)}l${n(-s * 0.75)} ${n(-s)}Z" fill="${fill}"/>`;

/**
 * Glass gold: a clean gold body, a glossy highlight across the top and a deeper base, all crisp.
 * On a light ground the body is deeper and the highlight softer, so the gold still reads.
 */
const glassGold = (d, transform, light = false) =>
  (light ? ['glassGoldDeep', 'glassGlossSoft', 'glassBase'] : ['glassGold', 'glassGloss', 'glassBase'])
    .map((g) => `<path d="${d}" transform="${transform}" fill="url(#${g})"/>`)
    .join('');

// ---------- the mark ----------
const markFile = readFileSync(join(HERE, '../../concepts/indigo-styles/mark-indigo-white-line.svg'), 'utf8');
// The centre drop in red (top light, bottom deep).
const markInner = markFile
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title>.*?<\/title>/, '')
  .replace(/(<linearGradient id="mk-line"[^>]*>)[\s\S]*?(<\/linearGradient>)/, '$1<stop offset="0" stop-color="#F0483C"/><stop offset="1" stop-color="#B8141F"/>$2')
  // a soft white light behind the red drop (instead of a dark-red blur), so it reads clearly
  .replace(/fill="#FFFFFF" fill-opacity="0.55" filter="url\(#mk-b2\)"/, 'fill="#FFFFFF" fill-opacity="0.7" filter="url(#mk-b2)"')
  // fill in the glass under the drop: the cut-out let the dark underside show around it
  .replace('<g mask="url(#mk-cut)">', '<g>');

/** The glass mark, centred on cx, its drop top at `top`, drop width `w`. */
function mark(cx, top, w) {
  const k = w / 168;
  const vb = { x: 128 - 150, y: 0, w: 300, h: 300 };
  return `<svg x="${n(cx - (vb.w / 2) * k)}" y="${n(top - 14 * k)}" width="${n(vb.w * k)}" height="${n(vb.h * k)}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" overflow="visible">${markInner}</svg>`;
}

const rounded = (x, y, w, h, r) => `M${n(x + r)} ${n(y)}H${n(x + w - r)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)}V${n(y + h - r)}Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}H${n(x + r)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r)}V${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Z`;

/** A thin vertical rule between zones, with a small gold diamond at its middle. */
const divider = (x) => `
<line x1="${x}" y1="150" x2="${x}" y2="${H / 2 - 30}" stroke="${C.soft}" stroke-opacity="0.3" stroke-width="2"/>
${diamond(x, H / 2, 12, C.gold)}
<line x1="${x}" y1="${H / 2 + 30}" x2="${x}" y2="${H - 150}" stroke="${C.soft}" stroke-opacity="0.3" stroke-width="2"/>`;

// ---------- zones ----------
// The mark and the name sit together as one lockup, centred on the board; the proprietor is small,
// bottom right.
const SRI_SHARE = 1.45; // శ్రీ's height, as a share of MANA WASH's cap height
const NAME_GAP = 150; // between శ్రీ and MANA WASH
const capH = T.name.bottom - T.name.top;
const DROP_H = capH * 1.5; // the drop stands about as tall as శ్రీ, a little taller than the capitals
const MARK_W = DROP_H / (236 / 168); // the drop (tip to base, with its edge) is 236 units tall for 168 wide
const CENTRE_Y = H / 2 - 40; // the line the capitals, శ్రీ and the drop are centred on
const sriK = (capH * SRI_SHARE) / (T.sri.bottom - T.sri.top);
const nameInk = T.name.width; // tracking goes only between letters, so this is the ink's width
const nameW = T.sri.width * sriK + NAME_GAP + nameInk;
const LOCKUP_GAP = 190;
const lockupLeft = (W - (MARK_W + LOCKUP_GAP + nameW)) / 2;
const MARK_CX = lockupLeft + MARK_W / 2;
const NAME_LEFT = lockupLeft + MARK_W + LOCKUP_GAP;

/** The glass mark. */
function brand() {
  return `
${mark(MARK_CX, CENTRE_Y - DROP_H / 2, MARK_W)}
${sparkle(MARK_CX - MARK_W * 0.75, CENTRE_Y + DROP_H * 0.4, 18, C.white, 0.75)}`;
}

/** శ్రీ in gold, then MANA WASH, side by side on one line. */
function name() {
  const capTop = T.name.top;
  const sriH = capH * SRI_SHARE;
  const sriW = T.sri.width * sriK;
  const left = NAME_LEFT;
  const baseY = CENTRE_Y - capTop - capH / 2;
  const sriTop = baseY + capTop + capH / 2 - sriH / 2;
  const wordX = left + sriW + NAME_GAP;
  return `
${glassGold(T.sri.d, `translate(${n(left)} ${n(sriTop - T.sri.top * sriK)}) scale(${n(sriK)})`)}
${text('name', wordX, baseY, C.white)}
${sparkle(wordX + nameInk + 110, baseY + capTop - 40, 36)}`;
}

/** One line along the bottom, centred: PRIMARY number · SECONDARY number · PROPRIETOR name. */
function details() {
  const y = 768;
  const labelGap = 24; // label to its value
  const sep = 120; // between the three pairs, with a gold diamond in the middle
  const pairs = [
    ['primaryLabel', 'primary'],
    ['secondaryLabel', 'secondary'],
    ['ownerLabel', 'owner'],
  ];
  const pairW = ([l, v]) => T[l].width + labelGap + T[v].width;
  const total = pairs.reduce((sum, p) => sum + pairW(p), 0) + sep * (pairs.length - 1);
  let x = (W - total) / 2;
  let out = '';
  pairs.forEach(([l, v], i) => {
    if (i > 0) {
      out += diamond(x - sep / 2, y - 21, 10, C.gold);
    }
    out += text(l, x, y - 3, C.gold);
    x += T[l].width + labelGap;
    out += text(v, x, y, C.pale);
    x += T[v].width + sep;
  });
  return out;
}

/**
 * The back. Centre: "Thank you" in a gold script, VISIT AGAIN beneath in the front's bold capitals
 * between two gold rules. Left: the mark. Right: శ్రీ over MANA / WASH, the same height as the mark.
 */
// The back is pearl (ivory), like the back of the visiting cards, with indigo lettering and deep gold.
const PEARL = { ink: '#141B47', indigo: '#1B2878', soft: '#5C6AA8', rule: '#C99A4E' };

function back() {
  const cx = W / 2;
  // Centre stack, sized from the ink so it sits evenly between the borders.
  const thanksH = T.thanks.bottom - T.thanks.top;
  const againCap = T.again.bottom - T.again.top;
  const gap = 34;
  const stackH = thanksH + gap + againCap;
  const top = (H - stackH) / 2 - 18;
  const thanksY = top - T.thanks.top;
  const againY = top + thanksH + gap - T.again.top;
  const half = T.again.width / 2;
  const ruleY = againY - againCap / 2;
  const centre = `
${glassGold(T.thanks.d, `translate(${n(cx - T.thanks.width / 2)} ${n(thanksY)})`, true)}
<line x1="${n(cx - half - 300)}" y1="${n(ruleY)}" x2="${n(cx - half - 60)}" y2="${n(ruleY)}" stroke="${PEARL.rule}" stroke-width="4"/>
${diamond(cx - half - 300, ruleY, 12, PEARL.rule)}
<line x1="${n(cx + half + 60)}" y1="${n(ruleY)}" x2="${n(cx + half + 300)}" y2="${n(ruleY)}" stroke="${PEARL.rule}" stroke-width="4"/>
${diamond(cx + half + 300, ruleY, 12, PEARL.rule)}
${text('again', cx, againY, PEARL.indigo, 'middle')}`;

  // The two ends: the mark on the left, శ్రీ MANA WASH on the right, each centred in its end zone.
  const endH = 380;
  const midY = H / 2 - 20;
  const zone = 640; // centre of each end zone, measured from the board's edge
  const markW = endH / (236 / 168);
  const left = `
${mark(zone, midY - endH / 2, markW)}
${sparkle(zone + markW * 0.85, midY - endH * 0.38, 22, PEARL.rule)}`;

  const capS = T.manaSmall.bottom - T.manaSmall.top;
  const washCap = T.washSmall.bottom - T.washSmall.top;
  const sriH = endH - capS - washCap - 40 - 36;
  const kS = sriH / (T.sriSmall.bottom - T.sriSmall.top);
  const rx = W - zone;
  const sriTop = midY - endH / 2;
  const manaY = sriTop + sriH + 40 - T.manaSmall.top;
  const washY = manaY + T.manaSmall.bottom + 36 - T.washSmall.top;
  const right = `
${glassGold(T.sriSmall.d, `translate(${n(rx - (T.sriSmall.width * kS) / 2)} ${n(sriTop - T.sriSmall.top * kS)}) scale(${n(kS)})`, true)}
${text('manaSmall', rx, manaY, PEARL.ink, 'middle')}
${text('washSmall', rx, washY, PEARL.soft, 'middle')}`;

  return centre + left + right;
}

// ---------- documents ----------
const backdrop = `
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#bgx)"/>
<rect width="${W}" height="${H}" fill="url(#glowA)"/>
<rect width="${W}" height="${H}" fill="url(#glowB)"/>
<rect width="${W}" height="${H}" fill="url(#glowC)"/>
<rect width="${W}" height="${H}" fill="url(#glowAqua)"/>
<rect width="${W}" height="${H}" fill="url(#sheen)"/>
<g fill="#FFFFFF">${STARS.map(([x, y, r, o]) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill-opacity="${n(o)}"/>`).join('')}</g>
${ribbon({ y0: 830, amp: 26, width: 70, phase: 0.4 })}
<rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="28" fill="none" stroke="url(#goldH)" stroke-opacity="0.55" stroke-width="3"/>
<rect x="54" y="54" width="${W - 108}" height="${H - 108}" rx="20" fill="none" stroke="${C.soft}" stroke-opacity="0.16" stroke-width="1.5"/>`;

const pearlBackdrop = `
<rect width="${W}" height="${H}" fill="url(#pearl)"/>
${ribbon({ y0: 830, amp: 26, width: 70, phase: 0.4, stroke: 'ribPearl', opacity: 0.3 })}
<rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="28" fill="none" stroke="url(#goldDeep)" stroke-opacity="0.7" stroke-width="3"/>
<rect x="54" y="54" width="${W - 108}" height="${H - 108}" rx="20" fill="none" stroke="${PEARL.soft}" stroke-opacity="0.14" stroke-width="1.5"/>`;

const SIDES = [
  { file: 'mana-name-board-15x3', label: 'Sri Mana Wash name board', body: `${backdrop}\n${brand()}\n${name()}\n${details()}` },
  { file: 'mana-name-board-15x3-back', label: 'Sri Mana Wash name board, back (thank you)', body: `${pearlBackdrop}\n${back()}` },
];

for (const side of SIDES) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="4572mm" height="914.4mm" role="img" aria-label="${side.label}">
<title>${side.label} (15 ft × 3 ft)</title>
<defs>${defs}</defs>
${side.body}
</svg>
`;
  const svgPath = join(HERE, `${side.file}.svg`);
  writeFileSync(svgPath, svg);
  await sharp(Buffer.from(svg.replace('width="4572mm" height="914.4mm"', `width="${W}" height="${H}"`)))
    .png()
    .toFile(join(HERE, `${side.file}-preview.png`));
  console.log('wrote', `${side.file}.svg and preview`);
  printPdfs(svgPath, side.file, side.label);
}

/** Print PDFs through headless Chrome (vector, at full size and at half scale). */
function printPdfs(svgPath, file, label) {
  if (!existsSync(CHROME)) return;
  for (const [suffix, scale] of [
    ['', 1],
    ['-half-scale', 0.5],
  ]) {
    const w = `${4572 * scale}mm`;
    const h = `${914.4 * scale}mm`;
    const htmlPath = join(HERE, `.${file}-print${suffix}.html`);
    writeFileSync(
      htmlPath,
      `<!doctype html><meta charset="utf-8"><title>${label}</title><style>@page{size:${w} ${h};margin:0}html,body{margin:0;padding:0}img{display:block;width:${w};height:${h}}</style><img src="${pathToFileURL(svgPath).href}">`,
    );
    const out = join(HERE, `${file}${suffix}.pdf`);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--print-to-pdf=${out}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
    execFileSync('rm', ['-f', htmlPath]);
    console.log('wrote', `${file}${suffix}.pdf`);
  }
}
