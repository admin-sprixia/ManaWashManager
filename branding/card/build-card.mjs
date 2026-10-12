// Builds the MANA hang-tag card (front and back) as print-ready SVGs, plus PNG previews.
//   CARD_URL=https://… PYTHON=/path/to/python-with-fonttools node branding/card/build-card.mjs
//
// Card: 55 × 110 mm, 1 unit = 0.1 mm.
// Front: the indigo glass mark (white centre line), శ్రీ MANA / WASH (Sri in Telugu), a fine-line water ribbon
// and the line "Some journeys stay with us forever."
// Back: a QR code for CARD_URL with the mark in its centre, GET THE APP · REVIEW US, and Thank you.
// All lettering is outlined from macOS system fonts (Didot, Avenir Next) by outline-text.py,
// so the files print the same with no fonts installed.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.CARD_URL || 'https://manawashmanager.com';
const PYTHON = process.env.PYTHON || 'python3';

const W = 550;
const H = 1100;
const CX = W / 2;
const R = 36; // corner radius

// Card colours are the Android app icon's background (branding/android-icon/background.svg).
const C = {
  night0: '#1B2878',
  night1: '#0C1442',
  night2: '#060A22',
  glow: '#5468D4',
  white: '#FFFFFF',
  pale: '#E6EAFF', // tagline, a touch softer than pure white
  ink: '#141B47', // QR modules on the white panel
  indigo: '#2D3D9E',
  mid: '#4458CC',
  soft: '#9BAEF5',
  mist: '#DDE3FA',
  // gandham bottu (sandalwood paste) gold, for శ్రీ
  gandhamLight: '#F8E2B0',
  gandham: '#E8BF78',
  gandhamDeep: '#CF9C52',
};

// A few faint stars, like the app icon. [x, y, r] in card units.
const STARS = [
  [74, 150, 1.8], [128, 92, 1.2], [446, 132, 2], [492, 230, 1.3], [62, 420, 1.5], [500, 470, 1.2],
  [96, 640, 1.1], [470, 610, 1.7], [58, 860, 1.4], [494, 820, 1.1], [120, 1010, 1.6], [430, 1040, 1.2],
];

const n = (v) => String(Math.round(v * 100) / 100);

// ---------- lettering ----------
const SUP = '/System/Library/Fonts/Supplemental';
const DIDOT = `${SUP}/Didot.ttc`;
const AVENIR = '/System/Library/Fonts/Avenir Next.ttc';
const TELUGU = `${SUP}/Telugu Sangam MN.ttc`; // bold face: once fitted to MANA's cap height its strokes match Didot's weight

const TEXT = [
  { id: 'sri', font: TELUGU, index: 1, text: 'శ్రీ', size: 70 },
  { id: 'mana', font: DIDOT, index: 0, text: 'MANA', size: 70, tracking: 0.3 },
  { id: 'wash', font: AVENIR, index: 5, text: 'WASH', size: 20, tracking: 0.7 },
  { id: 'tag1', font: DIDOT, index: 1, text: 'Some journeys', size: 37, tracking: 0.01 },
  { id: 'tag2', font: DIDOT, index: 1, text: 'stay with us forever.', size: 37, tracking: 0.01 },
  { id: 'cta1', font: AVENIR, index: 2, text: 'GET THE APP', size: 17, tracking: 0.34 },
  { id: 'cta2', font: AVENIR, index: 2, text: 'REVIEW US', size: 17, tracking: 0.34 },
  { id: 'scan', font: DIDOT, index: 1, text: 'Scan with your phone camera', size: 22, tracking: 0.01 },
  { id: 'thanks', font: DIDOT, index: 1, text: 'Thank you', size: 46, tracking: 0.01 },
  { id: 'sriSmall', font: TELUGU, index: 1, text: 'శ్రీ', size: 28 },
  { id: 'manaSmall', font: DIDOT, index: 0, text: 'MANA WASH', size: 28, tracking: 0.3 },
];
const T = JSON.parse(
  execFileSync(PYTHON, [join(HERE, 'outline-text.py')], { input: JSON.stringify(TEXT) }).toString(),
);

/** Outlined text centred on x, baseline at y. */
/**
 * Several outlined pieces in one row, `gap` apart, the whole row centred on x, baseline at y.
 * A piece can be [id, fill, fitTo]: it is then scaled so its ink runs exactly from the top to the
 * bottom of the `fitTo` piece's ink (శ్రీ stands as tall as MANA's capitals, no taller).
 */
const row = (parts, x, y, gap) => {
  const placed = parts.map(([id, fill, fitTo]) => {
    if (!fitTo) return { id, fill, k: 1, dy: 0, w: T[id].width };
    const k = (T[fitTo].bottom - T[fitTo].top) / (T[id].bottom - T[id].top);
    return { id, fill, k, dy: T[fitTo].top - T[id].top * k, w: T[id].width * k };
  });
  const total = placed.reduce((w, p) => w + p.w, 0) + gap * (placed.length - 1);
  let left = x - total / 2;
  return placed
    .map(({ id, fill, k, dy, w }) => {
      const out = `<path d="${T[id].d}" transform="translate(${n(left)} ${n(y + dy)}) scale(${n(k)})" fill="${fill}"/>`;
      left += w + gap;
      return out;
    })
    .join('');
};

const text = (id, x, y, fill, extra = '') =>
  `<path d="${T[id].d}" transform="translate(${n(x - T[id].width / 2)} ${n(y)})" fill="${fill}"${extra}/>`;

// ---------- shared pieces ----------
/** glowY: where the soft light behind the main element sits, as a fraction of the card height. */
const paperDefs = (p, glowY) => `
<linearGradient id="${p}-gandham" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${C.gandhamLight}"/><stop offset="0.55" stop-color="${C.gandham}"/><stop offset="1" stop-color="${C.gandhamDeep}"/>
</linearGradient>
<linearGradient id="${p}-paper" x1="0.2" y1="0" x2="0.8" y2="1">
  <stop offset="0" stop-color="${C.night0}"/><stop offset="0.5" stop-color="${C.night1}"/><stop offset="1" stop-color="${C.night2}"/>
</linearGradient>
<radialGradient id="${p}-glow" cx="0.5" cy="${glowY}" r="0.62" gradientTransform="translate(0.5 ${glowY}) scale(1 0.5) translate(-0.5 -${glowY})">
  <stop offset="0" stop-color="${C.glow}" stop-opacity="0.42"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="${p}-sheen" cx="0.5" cy="0" r="0.8" gradientTransform="translate(0.5 0) scale(1 0.5) translate(-0.5 0)">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
</radialGradient>
<filter id="${p}-grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="t"/>
  <feColorMatrix in="t" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0"/>
  <feComposite operator="in" in2="SourceGraphic"/>
</filter>
<clipPath id="${p}-card"><rect width="${W}" height="${H}" rx="${R}"/></clipPath>`;

/** Card stock: night-indigo gradient, glow, sheen, stars, fine grain and a hairline inset frame. */
const paper = (p) => `
<rect width="${W}" height="${H}" rx="${R}" fill="url(#${p}-paper)"/>
<rect width="${W}" height="${H}" rx="${R}" fill="url(#${p}-glow)"/>
<rect width="${W}" height="${H}" rx="${R}" fill="url(#${p}-sheen)"/>
<rect width="${W}" height="${H}" rx="${R}" fill="#000" filter="url(#${p}-grain)" opacity="0.035"/>
<g fill="#FFFFFF" fill-opacity="0.5">${STARS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
<rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="${R - 14}" fill="none" stroke="${C.soft}" stroke-opacity="0.3" stroke-width="1"/>
<rect x="26" y="26" width="${W - 52}" height="${H - 52}" rx="${R - 18}" fill="none" stroke="${C.soft}" stroke-opacity="0.12" stroke-width="0.6"/>`;

/**
 * A ribbon of fine lines that twists like moving water (the gold wave on the reference tag,
 * redrawn in the brand's indigo). Lines run edge to edge and are clipped by the card.
 */
function ribbon(p, { y0, amp, width, lines = 30, phase = 0, opacity = 1 }) {
  const paths = [];
  for (let i = 0; i < lines; i++) {
    const t = i / (lines - 1) - 0.5; // -0.5 … 0.5 across the ribbon
    let d = '';
    for (let x = -20; x <= W + 20; x += 10) {
      const u = x / W;
      const centre = y0 + amp * Math.sin(u * Math.PI * 1.6 + phase);
      // the ribbon's width swells and pinches, so it reads as a twisting band
      const spread = width * (0.25 + 0.75 * Math.abs(Math.cos(u * Math.PI * 1.15 + phase * 0.6)));
      const y = centre + t * spread + 6 * Math.sin(u * Math.PI * 3 + t * 2);
      d += `${x === -20 ? 'M' : 'L'}${n(x)} ${n(y)}`;
    }
    const edge = 1 - Math.abs(t) * 1.4; // lines in the middle of the band are a touch stronger
    paths.push(`<path d="${d}" stroke-opacity="${n(0.35 + 0.55 * edge)}"/>`);
  }
  return `
<linearGradient id="${p}-rib" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.glow}" stop-opacity="0.2"/>
  <stop offset="0.35" stop-color="${C.soft}"/>
  <stop offset="0.7" stop-color="${C.pale}"/>
  <stop offset="1" stop-color="${C.soft}" stop-opacity="0.4"/>
</linearGradient>
<g fill="none" stroke="url(#${p}-rib)" stroke-width="0.9" stroke-linecap="round" opacity="${opacity}">${paths.join('')}</g>`;
}

// ---------- the mark ----------
const markFile = readFileSync(join(HERE, '../concepts/indigo-styles/mark-indigo-white-line.svg'), 'utf8');
const markInner = markFile.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>.*?<\/title>/, '');

/** The glass mark, centred on cx, its drop top at `top`, drop width `w`. */
function mark(cx, top, w) {
  // In the mark's own units the drop spans x 44…212 and y 14…266; the ground shadow sits below.
  const k = w / 168;
  const vb = { x: 128 - 150, y: 0, w: 300, h: 300 };
  return `<svg x="${n(cx - (vb.w / 2) * k)}" y="${n(top - 14 * k)}" width="${n(vb.w * k)}" height="${n(vb.h * k)}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" overflow="visible">${markInner}</svg>`;
}

// ---------- QR ----------
function qr(cx, cy, size) {
  const q = qrcode(0, 'H'); // high error correction, so the mark in the centre is safe
  q.addData(URL_);
  q.make();
  const m = q.getModuleCount();
  const cell = size / m;
  const x0 = cx - size / 2;
  const y0 = cy - size / 2;
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= m - 7) || (r >= m - 7 && c < 7);
  const clear = Math.ceil(m * 0.24) | 1; // odd, so the cleared square is centred
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
<rect x="${n(cx - logoBox / 2 + cell * 0.6)}" y="${n(cy - logoBox / 2 + cell * 0.6)}" width="${n(logoBox - cell * 1.2)}" height="${n(logoBox - cell * 1.2)}" rx="${n(logoBox * 0.24)}" fill="#FFFFFF" stroke="${C.mist}" stroke-width="1"/>
${mark(cx, cy - logoBox * 0.36, logoBox * 0.5)}`;
}

// ---------- documents ----------
const doc = (title, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="55mm" height="110mm" role="img" aria-label="${title}">
<title>${title}</title>
<defs>${defs}</defs>
${body}
</svg>
`;

function front() {
  const p = 'f';
  const rib = ribbon(p, { y0: 735, amp: 46, width: 92, phase: 0.35, opacity: 0.75 });
  const ruleY = 566;
  const half = T.wash.width / 2;
  const body = `
${paper(p)}
<g clip-path="url(#${p}-card)">${rib}</g>
${mark(CX, 168, 160)}
${row([['sri', `url(#${p}-gandham)`, 'mana'], ['mana', C.white]], CX, 500, 26)}
<line x1="${n(CX - half - 74)}" y1="${ruleY}" x2="${n(CX - half - 22)}" y2="${ruleY}" stroke="${C.soft}" stroke-opacity="0.6" stroke-width="1"/>
<line x1="${n(CX + half + 22)}" y1="${ruleY}" x2="${n(CX + half + 74)}" y2="${ruleY}" stroke="${C.soft}" stroke-opacity="0.6" stroke-width="1"/>
${text('wash', CX, ruleY + 7, C.soft)}
${text('tag1', CX, 902, C.pale)}
${text('tag2', CX, 950, C.pale)}
<path d="M${CX} 996 l5 7 l-5 7 l-5 -7 Z" fill="${C.soft}" opacity="0.9"/>
<line x1="${CX - 46}" y1="1003" x2="${CX - 14}" y2="1003" stroke="${C.soft}" stroke-opacity="0.4" stroke-width="0.8"/>
<line x1="${CX + 14}" y1="1003" x2="${CX + 46}" y2="1003" stroke="${C.soft}" stroke-opacity="0.4" stroke-width="0.8"/>`;
  return doc('MANA Car Wash card front', paperDefs(p, 0.26), body);
}

function back() {
  const p = 'b';
  const qrSize = 300;
  const qrCy = 462;
  const frame = qrSize + 52;
  const rib = ribbon(p, { y0: 1032, amp: 24, width: 58, phase: 2.2, lines: 26, opacity: 0.6 });
  // GET THE APP · REVIEW US, with the dot in brand periwinkle
  const gap = 34;
  const total = T.cta1.width + gap * 2 + T.cta2.width;
  const left = CX - total / 2;
  const ctaY = 742;
  const body = `
${paper(p)}
<g clip-path="url(#${p}-card)">${rib}</g>
${row([['sriSmall', `url(#${p}-gandham)`, 'manaSmall'], ['manaSmall', C.white]], CX, 190, 13)}
<rect x="${CX - frame / 2}" y="${qrCy - frame / 2}" width="${frame}" height="${frame}" rx="30" fill="#FFFFFF" stroke="${C.soft}" stroke-opacity="0.5" stroke-width="1"/>
${corners(CX, qrCy, frame + 22)}
${qr(CX, qrCy, qrSize)}
<path d="${T.cta1.d}" transform="translate(${n(left)} ${ctaY})" fill="${C.white}"/>
<circle cx="${n(left + T.cta1.width + gap)}" cy="${ctaY - 6}" r="3.6" fill="${C.soft}"/>
<path d="${T.cta2.d}" transform="translate(${n(left + T.cta1.width + gap * 2)} ${ctaY})" fill="${C.white}"/>
<line x1="${CX - 60}" y1="${ctaY + 36}" x2="${CX + 60}" y2="${ctaY + 36}" stroke="${C.soft}" stroke-opacity="0.4" stroke-width="0.8"/>
${text('scan', CX, ctaY + 82, C.soft)}
${text('thanks', CX, 925, C.white)}`;
  return doc('MANA Car Wash card back', paperDefs(p, 0.42), body);
}

/** Four thin L-brackets around the QR frame, like a viewfinder. */
function corners(cx, cy, s) {
  const h = s / 2;
  const l = 26;
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
  return `<path d="${d}" fill="none" stroke="${C.soft}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const files = { 'mana-card-front.svg': front(), 'mana-card-back.svg': back() };
for (const [name, svg] of Object.entries(files)) {
  writeFileSync(join(HERE, name), svg);
  // 600 dpi preview: 55 mm ≈ 1300 px
  await sharp(Buffer.from(svg), { density: 600 }).png().toFile(join(HERE, name.replace('.svg', '.png')));
  console.log('wrote', name);
}
console.log('QR →', URL_);
