// Builds the MANA shop-front flex banner (30 ft × 3 ft) as a print-ready SVG and PDF, plus a PNG preview.
//   CARD_URL=https://… PYTHON=/path/to/python-with-fonttools node branding/flex/build-flex.mjs
//
// Same look as the hang-tag card (branding/card): the app icon's night-indigo background, the glass
// mark, Didot + Avenir Next lettering outlined to paths, the fine-line water ribbon, and the QR.
// 1 unit = 1/300 ft (≈ 1.016 mm), so the banner is 9000 × 900 units.
// Three zones, left to right: brand · services · contact and QR.
// Shop details come from the Kovur branch (apps/api/seed.sql); check them before printing.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.CARD_URL || 'https://manawashmanager.com';
const PYTHON = process.env.PYTHON || 'python3';

const SHOP = {
  phone: '98886 26111',
  hours: 'Open daily  ·  7 AM – 8 PM',
  address: 'Main Road, near Bus Stand, Kovur',
};

const W = 9000;
const H = 900;

const C = {
  night0: '#1B2878',
  night1: '#0C1442',
  night2: '#060A22',
  glow: '#5468D4',
  white: '#FFFFFF',
  pale: '#E6EAFF',
  ink: '#141B47',
  indigo: '#2D3D9E',
  soft: '#9BAEF5',
  mist: '#DDE3FA',
};

const n = (v) => String(Math.round(v * 100) / 100);

// ---------- lettering ----------
const DIDOT = '/System/Library/Fonts/Supplemental/Didot.ttc';
const AVENIR = '/System/Library/Fonts/Avenir Next.ttc';
const DIDOT_R = { font: DIDOT, index: 0 };
const DIDOT_I = { font: DIDOT, index: 1 };
const AV_DEMI = { font: AVENIR, index: 2 };
const AV_MED = { font: AVENIR, index: 5 };

const SERVICES = [
  'Foam Wash',
  'Interior Cleaning',
  'Underbody Cleaning',
  'AC & Cabin Hygiene',
  'Bike Wash & Polish',
  'Chain Clean & Lube',
];

const TEXT = [
  { id: 'mana', ...DIDOT_R, text: 'MANA', size: 330, tracking: 0.22 },
  { id: 'carwash', ...AV_MED, text: 'CAR WASH', size: 66, tracking: 0.62 },
  { id: 'tagline', ...DIDOT_I, text: 'Some journeys stay with us forever.', size: 74, tracking: 0.01 },
  { id: 'headline', ...AV_DEMI, text: 'PREMIUM CAR & BIKE CARE', size: 74, tracking: 0.3 },
  ...SERVICES.map((s, i) => ({ id: `svc${i}`, ...AV_MED, text: s, size: 64, tracking: 0.03 })),
  { id: 'doorstep', ...DIDOT_I, text: 'Doorstep wash at your apartment · monthly plans', size: 70, tracking: 0.01 },
  { id: 'callLabel', ...AV_DEMI, text: 'CALL  ·  WHATSAPP', size: 46, tracking: 0.36 },
  { id: 'phone', ...AV_DEMI, text: SHOP.phone, size: 196, tracking: 0.04 },
  { id: 'hours', ...AV_MED, text: SHOP.hours, size: 56, tracking: 0.04 },
  { id: 'address', ...DIDOT_I, text: SHOP.address, size: 62, tracking: 0.01 },
  { id: 'cta', ...AV_DEMI, text: 'GET THE APP  ·  REVIEW US', size: 36, tracking: 0.3 },
];
const T = JSON.parse(
  execFileSync(PYTHON, [join(HERE, '../card/outline-text.py')], { input: JSON.stringify(TEXT) }).toString(),
);

/** Outlined text. anchor: 'start' (x = left edge) or 'middle'. Baseline at y. */
const text = (id, x, y, fill, anchor = 'start') => {
  const left = anchor === 'middle' ? x - T[id].width / 2 : x;
  return `<path d="${T[id].d}" transform="translate(${n(left)} ${n(y)})" fill="${fill}"/>`;
};

// ---------- background ----------
const STARS = Array.from({ length: 46 }, (_, i) => {
  // deterministic scatter, kept away from the busiest text
  const x = (i * 1973 + 311) % W;
  const y = 60 + ((i * 587 + 97) % (H - 120));
  const r = 2 + ((i * 7) % 5) * 0.6;
  return [x, y, r];
});

const defs = `
<linearGradient id="bg" x1="0" y1="0" x2="0.12" y2="1">
  <stop offset="0" stop-color="${C.night0}"/><stop offset="0.55" stop-color="${C.night1}"/><stop offset="1" stop-color="${C.night2}"/>
</linearGradient>
<linearGradient id="bgx" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.night0}" stop-opacity="0.55"/><stop offset="0.5" stop-color="${C.night1}" stop-opacity="0"/><stop offset="1" stop-color="${C.night0}" stop-opacity="0.45"/>
</linearGradient>
<radialGradient id="glowA" cx="${n(560 / W)}" cy="0.5" r="0.12" gradientTransform="translate(${n(560 / W)} 0.5) scale(1 10) translate(-${n(560 / W)} -0.5)">
  <stop offset="0" stop-color="${C.glow}" stop-opacity="0.55"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="glowC" cx="${n(8480 / W)}" cy="0.45" r="0.1" gradientTransform="translate(${n(8480 / W)} 0.45) scale(1 10) translate(-${n(8480 / W)} -0.45)">
  <stop offset="0" stop-color="${C.glow}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.12"/><stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>
<linearGradient id="rib" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.glow}" stop-opacity="0.1"/>
  <stop offset="0.2" stop-color="${C.soft}" stop-opacity="0.8"/>
  <stop offset="0.5" stop-color="${C.pale}" stop-opacity="0.55"/>
  <stop offset="0.8" stop-color="${C.soft}" stop-opacity="0.8"/>
  <stop offset="1" stop-color="${C.glow}" stop-opacity="0.15"/>
</linearGradient>`;

/** The twisting fine-line water ribbon from the card, stretched along the whole banner. */
function ribbon({ y0, amp, width, lines = 34, waves = 3.2, phase = 0 }) {
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
  return `<g fill="none" stroke="url(#rib)" stroke-width="2.2" stroke-linecap="round" opacity="0.5">${paths.join('')}</g>`;
}

// ---------- the mark ----------
const markFile = readFileSync(join(HERE, '../concepts/indigo-styles/mark-indigo-white-line.svg'), 'utf8');
const markInner = markFile.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>.*?<\/title>/, '');

/** The glass mark, centred on cx, its drop top at `top`, drop width `w`. */
function mark(cx, top, w) {
  const k = w / 168;
  const vb = { x: 128 - 150, y: 0, w: 300, h: 300 };
  return `<svg x="${n(cx - (vb.w / 2) * k)}" y="${n(top - 14 * k)}" width="${n(vb.w * k)}" height="${n(vb.h * k)}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" overflow="visible">${markInner}</svg>`;
}

// ---------- QR (same styling as the card) ----------
function qr(cx, cy, size) {
  const q = qrcode(0, 'H');
  q.addData(URL_);
  q.make();
  const m = q.getModuleCount();
  const cell = size / m;
  const x0 = cx - size / 2;
  const y0 = cy - size / 2;
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= m - 7) || (r >= m - 7 && c < 7);
  const clear = Math.ceil(m * 0.24) | 1;
  const lo = (m - clear) / 2;
  const inLogo = (r, c) => r >= lo && r < lo + clear && c >= lo && c < lo + clear;
  let dots = '';
  for (let r = 0; r < m; r++)
    for (let c = 0; c < m; c++) {
      if (!q.isDark(r, c) || finder(r, c) || inLogo(r, c)) continue;
      dots += `<rect x="${n(x0 + c * cell + cell * 0.06)}" y="${n(y0 + r * cell + cell * 0.06)}" width="${n(cell * 0.88)}" height="${n(cell * 0.88)}" rx="${n(cell * 0.36)}"/>`;
    }
  const eye = (r, c) => {
    const x = x0 + c * cell;
    const y = y0 + r * cell;
    return (
      `<rect x="${n(x + cell * 0.5)}" y="${n(y + cell * 0.5)}" width="${n(cell * 6)}" height="${n(cell * 6)}" rx="${n(cell * 1.9)}" fill="none" stroke="${C.ink}" stroke-width="${n(cell)}"/>` +
      `<rect x="${n(x + cell * 2)}" y="${n(y + cell * 2)}" width="${n(cell * 3)}" height="${n(cell * 3)}" rx="${n(cell * 0.95)}" fill="${C.indigo}"/>`
    );
  };
  const logoBox = clear * cell;
  return `
<g fill="${C.ink}">${dots}</g>
${eye(0, 0)}${eye(0, m - 7)}${eye(m - 7, 0)}
<rect x="${n(cx - logoBox / 2 + cell * 0.6)}" y="${n(cy - logoBox / 2 + cell * 0.6)}" width="${n(logoBox - cell * 1.2)}" height="${n(logoBox - cell * 1.2)}" rx="${n(logoBox * 0.24)}" fill="#FFFFFF" stroke="${C.mist}" stroke-width="2"/>
${mark(cx, cy - logoBox * 0.36, logoBox * 0.5)}`;
}

/** Four L-brackets around a square, like a viewfinder. */
function corners(cx, cy, s, l = 50) {
  const h = s / 2;
  const d = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]
    .map(([sx, sy]) => {
      const x = cx + sx * h;
      const y = cy + sy * h;
      return `M${n(x - sx * l)} ${n(y)}L${n(x)} ${n(y)}L${n(x)} ${n(y - sy * l)}`;
    })
    .join('');
  return `<path d="${d}" fill="none" stroke="${C.soft}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const diamond = (x, y, s, fill = C.soft) => `<path d="M${n(x)} ${n(y - s)}l${n(s * 0.75)} ${n(s)}l${n(-s * 0.75)} ${n(s)}l${n(-s * 0.75)} ${n(-s)}Z" fill="${fill}"/>`;

/** A thin vertical rule between zones, with a small diamond at its middle. */
const divider = (x) => `
<line x1="${x}" y1="170" x2="${x}" y2="${H / 2 - 30}" stroke="${C.soft}" stroke-opacity="0.35" stroke-width="2"/>
${diamond(x, H / 2, 12)}
<line x1="${x}" y1="${H / 2 + 30}" x2="${x}" y2="${H - 170}" stroke="${C.soft}" stroke-opacity="0.35" stroke-width="2"/>`;

// ---------- zones ----------
function brand() {
  const markCx = 470;
  const textX = 830;
  const ruleY = 548;
  const cwX = textX + 110;
  return `
${mark(markCx, 175, 370)}
${text('mana', textX, 452, C.white)}
<line x1="${textX}" y1="${ruleY - 22}" x2="${textX + 80}" y2="${ruleY - 22}" stroke="${C.soft}" stroke-opacity="0.7" stroke-width="2.5"/>
${text('carwash', cwX, ruleY, C.soft)}
<line x1="${n(cwX + T.carwash.width + 30)}" y1="${ruleY - 22}" x2="${n(T.mana.width + textX)}" y2="${ruleY - 22}" stroke="${C.soft}" stroke-opacity="0.7" stroke-width="2.5"/>
${text('tagline', textX, 700, C.pale)}`;
}

function services() {
  const cx = 4250;
  const colW = 860;
  const left = cx - colW * 1.5;
  const rows = [400, 520];
  let items = '';
  SERVICES.forEach((_, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = left + col * colW + 40;
    const y = rows[row];
    items += diamond(x, y - 22, 13) + text(`svc${i}`, x + 36, y, C.white);
  });
  return `
${text('headline', cx, 250, C.white, 'middle')}
<line x1="${cx - 120}" y1="300" x2="${cx + 120}" y2="300" stroke="${C.soft}" stroke-opacity="0.6" stroke-width="2.5"/>
${items}
${text('doorstep', cx, 690, C.soft, 'middle')}`;
}

function contact() {
  const x = 6300;
  const qrCx = 8470;
  const qrCy = 400;
  const qrSize = 440;
  const frame = qrSize + 70;
  return `
${text('callLabel', x, 255, C.soft)}
<g transform="translate(${x} 292) scale(1.2)">${phoneIcon()}</g>
${text('phone', x + 175, 432, C.white)}
<line x1="${x}" y1="500" x2="${n(x + 175 + T.phone.width)}" y2="500" stroke="${C.soft}" stroke-opacity="0.35" stroke-width="2"/>
${text('hours', x, 600, C.white)}
${text('address', x, 700, C.soft)}
<rect x="${qrCx - frame / 2}" y="${qrCy - frame / 2}" width="${frame}" height="${frame}" rx="44" fill="#FFFFFF" stroke="${C.soft}" stroke-opacity="0.5" stroke-width="2"/>
${corners(qrCx, qrCy, frame + 34)}
${qr(qrCx, qrCy, qrSize)}
${text('cta', qrCx, 760, C.white, 'middle')}`;
}

/** A simple handset in a ring, drawn at 120 × 120. */
function phoneIcon() {
  return `<circle cx="60" cy="60" r="56" fill="none" stroke="${C.soft}" stroke-width="4"/>
<path transform="translate(30 30) scale(2.5)" fill="${C.white}" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>`;
}

// ---------- document ----------
const body = `
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#bgx)"/>
<rect width="${W}" height="${H}" fill="url(#glowA)"/>
<rect width="${W}" height="${H}" fill="url(#glowC)"/>
<rect width="${W}" height="${H}" fill="url(#sheen)"/>
<g fill="#FFFFFF" fill-opacity="0.45">${STARS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${n(r)}"/>`).join('')}</g>
${ribbon({ y0: 800, amp: 46, width: 120, phase: 0.4 })}
<rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="28" fill="none" stroke="${C.soft}" stroke-opacity="0.32" stroke-width="2.5"/>
<rect x="56" y="56" width="${W - 112}" height="${H - 112}" rx="20" fill="none" stroke="${C.soft}" stroke-opacity="0.14" stroke-width="1.5"/>
${brand()}
${divider(2480)}
${services()}
${divider(6020)}
${contact()}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="9144mm" height="914.4mm" role="img" aria-label="MANA Car Wash shop banner">
<title>MANA Car Wash shop banner (30 ft × 3 ft)</title>
<defs>${defs}</defs>
${body}
</svg>
`;

writeFileSync(join(HERE, 'mana-flex-30x3.svg'), svg);
// Preview PNG, 9000 × 900 px (one pixel per unit).
await sharp(Buffer.from(svg.replace('width="9144mm" height="914.4mm"', `width="${W}" height="${H}"`)))
  .png()
  .toFile(join(HERE, 'mana-flex-30x3-preview.png'));
console.log('wrote mana-flex-30x3.svg and preview · QR →', URL_);
