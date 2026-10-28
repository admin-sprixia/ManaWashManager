// Builds the MANA services board (30 ft × 3 ft) for inside the shop, as a print-ready SVG, full and
// half-scale PDFs, and a PNG preview. It's a marketing board, not the name board: what we do, with no
// prices, and how to reach us.
//   PYTHON=/path/to/python-with-fonttools node branding/flex/build-services-flex.mjs
//
// The brand's look on pearl, like the visiting cards' backs (the glass mark, indigo and deep gold, Didot and Avenir Next outlined
// to paths, the fine-line water ribbon) with the services as the hero: six big cards with gold icons.
// 1 unit = 1/300 ft (≈ 1.016 mm), so the board is 9000 × 900 units. Left to right: the mark · six
// service cards (add-ons beneath) · our numbers and promise. Check the numbers before printing.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.PYTHON || 'python3';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const CONTACT = {
  primary: '91547 52999',
  secondary: '77802 76797',
};

const W = 9000;
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
  // the pearl ground (like the visiting cards' backs) and the inks that read on it
  pearlTop: '#FDFCF8',
  pearlBottom: '#EFEDE6',
  inkDark: '#141B47',
  indigoInk: '#1B2878',
  slate: '#3A4370',
  softInk: '#5C6AA8',
  goldInk: '#9A6A22',
  goldRule: '#C99A4E',
};

const n = (v) => String(Math.round(v * 100) / 100);

// ---------- what we offer ----------
const CARDS = [
  { id: 'express', title: 'EXPRESS WASH', line: 'Quick shine in 20–30 min', points: ['Snow foam & hand wash', 'Tyre shine & outside glass', 'Rubber mats washed'], icon: 'watch' },
  { id: 'basic', title: 'BASIC WASH', line: 'Inside and out', points: ['Everything in Express', 'Full vacuum: seats, floor, boot', 'Dashboard & door shine'], icon: 'car', popular: true },
  { id: 'premium', title: 'PREMIUM WASH', line: 'The full treatment', points: ['Everything in Basic', 'Spray wax on all paint', 'Deep interior + rain repellent', 'Windshield cleaner liquid'], icon: 'gem' },
  { id: 'doorstep', title: 'DOORSTEP WASH', line: 'We come to your home', points: ['At your home or office', 'Book a time that suits you', 'Same care, no travel'], icon: 'home' },
  { id: 'plans', title: 'MONTHLY PLANS', line: 'One wash every week', points: ['Save every month', '3 months: a bonus wash free', '12 months: 1 month free'], icon: 'calendar' },
  { id: 'community', title: 'COMMUNITY WASH', line: 'We come to your apartment', points: ['Weekly wash days', 'Special community price', 'Pay easily online'], icon: 'building' },
  { id: 'rust', title: 'ANTI-RUST COATING', line: 'Protect it for years', points: ['Underbody rust protection', 'For new and old cars', 'Free pick-up for communities'], icon: 'shield' },
];

// ---------- lettering ----------
const SUP = '/System/Library/Fonts/Supplemental';
const DIDOT = `${SUP}/Didot.ttc`;
const AVENIR = '/System/Library/Fonts/Avenir Next.ttc';
const DIDOT_R = { font: DIDOT, index: 0 };
const DIDOT_I = { font: DIDOT, index: 1 };
const AV_BOLD = { font: AVENIR, index: 0 };
const AV_DEMI = { font: AVENIR, index: 2 };
const AV_MED = { font: AVENIR, index: 5 };

const TEXT = [
  ...CARDS.flatMap((c) => [
    { id: `${c.id}-title`, ...AV_BOLD, text: c.title, size: 74, tracking: 0.04 },
    { id: `${c.id}-line`, ...DIDOT_I, text: c.line, size: 56 },
    ...c.points.map((p, i) => ({ id: `${c.id}-p${i}`, ...AV_MED, text: p, size: 50, tracking: 0.01 })),
  ]),
  { id: 'popular', ...AV_BOLD, text: 'MOST POPULAR', size: 34, tracking: 0.24 },
  { id: 'callLabel', ...AV_DEMI, text: 'CALL  ·  WHATSAPP', size: 44, tracking: 0.32 },
  { id: 'primaryLabel', ...AV_BOLD, text: 'PRIMARY', size: 32, tracking: 0.3 },
  { id: 'primary', ...AV_DEMI, text: CONTACT.primary, size: 118, tracking: 0.02 },
  { id: 'secondaryLabel', ...AV_BOLD, text: 'SECONDARY', size: 32, tracking: 0.3 },
  { id: 'secondary', ...AV_DEMI, text: CONTACT.secondary, size: 100, tracking: 0.02 },
  { id: 'ownerLabel', ...AV_BOLD, text: 'PROPRIETOR', size: 32, tracking: 0.3 },
  { id: 'owner', ...AV_BOLD, text: 'Hrushikesh Vetagiri', size: 78, tracking: 0.01 },
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
const STARS = Array.from({ length: 70 }, () => [rand() * W, 50 + rand() * (H - 100), 1.6 + rand() * 2.6, 0.25 + rand() * 0.5]);

const defs = `
<linearGradient id="bg" x1="0" y1="0" x2="0.12" y2="1">
  <stop offset="0" stop-color="${C.night0}"/><stop offset="0.55" stop-color="${C.night1}"/><stop offset="1" stop-color="${C.night2}"/>
</linearGradient>
<linearGradient id="bgx" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.night0}" stop-opacity="0.6"/><stop offset="0.5" stop-color="${C.night1}" stop-opacity="0"/><stop offset="1" stop-color="${C.night0}" stop-opacity="0.5"/>
</linearGradient>
${glow('glowA', 500, 0.5, 0.1, C.glow, 0.65)}
${glow('glowB', 4540, 0.08, 0.2, C.glow, 0.35)}
${glow('glowC', 8200, 0.4, 0.12, C.glow, 0.45)}
${glow('glowAqua', 4540, 0.95, 0.24, C.aqua, 0.12)}
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.12"/><stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>
<linearGradient id="rib" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.glow}" stop-opacity="0.1"/><stop offset="0.2" stop-color="${C.soft}" stop-opacity="0.8"/>
  <stop offset="0.5" stop-color="${C.pale}" stop-opacity="0.55"/><stop offset="0.8" stop-color="${C.soft}" stop-opacity="0.8"/>
  <stop offset="1" stop-color="${C.glow}" stop-opacity="0.15"/>
</linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${C.goldLight}"/><stop offset="0.55" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDeep}"/>
</linearGradient>
<linearGradient id="goldH" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.goldDeep}"/><stop offset="0.5" stop-color="${C.goldLight}"/><stop offset="1" stop-color="${C.goldDeep}"/>
</linearGradient>
<linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.95"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0.7"/>
</linearGradient>
<linearGradient id="cardHot" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FBEFD6"/><stop offset="1" stop-color="#FFFFFF"/>
</linearGradient>
<linearGradient id="pearl" x1="0" y1="0" x2="0.12" y2="1">
  <stop offset="0" stop-color="${C.pearlTop}"/><stop offset="1" stop-color="${C.pearlBottom}"/>
</linearGradient>
<linearGradient id="ribPearl" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#9BAEF5" stop-opacity="0"/><stop offset="0.3" stop-color="#7F92DE" stop-opacity="0.8"/>
  <stop offset="0.7" stop-color="#7F92DE" stop-opacity="0.8"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/>
</linearGradient>
<linearGradient id="goldDeep" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#D2A250"/><stop offset="0.55" stop-color="#B07C2C"/><stop offset="1" stop-color="#8E5D1B"/>
</linearGradient>
`;

/** A soft radial light, stretched to the board's shape. */
function glow(id, cx, cy, r, color, opacity) {
  const fx = n(cx / W);
  return `<radialGradient id="${id}" cx="${fx}" cy="${cy}" r="${r}" gradientTransform="translate(${fx} ${cy}) scale(1 10) translate(-${fx} -${cy})">
  <stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
</radialGradient>`;
}

/** The twisting fine-line water ribbon from the card, stretched along the whole board. */
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
  return `<g fill="none" stroke="url(#ribPearl)" stroke-width="2.2" stroke-linecap="round" opacity="0.3">${paths.join('')}</g>`;
}

/** A four-point sparkle. */
const sparkle = (x, y, s, fill = C.goldRule, opacity = 1) =>
  `<path d="M${n(x)} ${n(y - s)}C${n(x + s * 0.12)} ${n(y - s * 0.12)} ${n(x + s * 0.12)} ${n(y - s * 0.12)} ${n(x + s)} ${n(y)}C${n(x + s * 0.12)} ${n(y + s * 0.12)} ${n(x + s * 0.12)} ${n(y + s * 0.12)} ${n(x)} ${n(y + s)}C${n(x - s * 0.12)} ${n(y + s * 0.12)} ${n(x - s * 0.12)} ${n(y + s * 0.12)} ${n(x - s)} ${n(y)}C${n(x - s * 0.12)} ${n(y - s * 0.12)} ${n(x - s * 0.12)} ${n(y - s * 0.12)} ${n(x)} ${n(y - s)}Z" fill="${fill}" fill-opacity="${opacity}"/>`;

const diamond = (x, y, s, fill = C.soft) => `<path d="M${n(x)} ${n(y - s)}l${n(s * 0.75)} ${n(s)}l${n(-s * 0.75)} ${n(s)}l${n(-s * 0.75)} ${n(-s)}Z" fill="${fill}"/>`;

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

// ---------- icons (drawn in a 100 × 100 box) ----------
const ICONS = {
  watch: '<circle cx="50" cy="56" r="30"/><path d="M42 18h16M50 18v8M50 56l14-12M74 30l6-6"/>',
  car: '<path d="M16 64l9-22q4-9 14-9h22q10 0 14 9l9 22v12H16z"/><path d="M24 50h52"/><circle cx="31" cy="76" r="7"/><circle cx="69" cy="76" r="7"/>',
  gem: '<path d="M30 28h40l16 18-36 40-36-40z"/><path d="M14 46h72M38 28l12 18 12-18M50 46v40"/>',
  calendar: '<rect x="18" y="24" width="64" height="60" rx="9"/><path d="M18 40h64M34 16v14M66 16v14M36 62l10 10 20-20"/>',
  building: '<rect x="28" y="16" width="44" height="70" rx="4"/><path d="M40 30h6M54 30h6M40 44h6M54 44h6M40 58h6M54 58h6M44 86V72h12v14"/>',
  home: '<path d="M14 50L50 20l36 30"/><path d="M24 42v42h52V42"/><path d="M42 84V62h16v22"/>',
  shield: '<path d="M50 14l32 12v24q0 26-32 38Q18 76 18 50V26z"/><path d="M36 52l10 10 18-20"/>',
};
function icon(name, cx, cy, size) {
  const k = size / 100;
  return `<g transform="translate(${n(cx - size / 2)} ${n(cy - size / 2)}) scale(${n(k)})" fill="none" stroke="${C.ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;
}

const rounded = (x, y, w, h, r) => `M${n(x + r)} ${n(y)}H${n(x + w - r)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)}V${n(y + h - r)}Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}H${n(x + r)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r)}V${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Z`;

/** A thin vertical rule between zones, with a small gold diamond at its middle. */
const divider = (x) => `
<line x1="${x}" y1="150" x2="${x}" y2="${H / 2 - 30}" stroke="${C.softInk}" stroke-opacity="0.35" stroke-width="2"/>
${diamond(x, H / 2, 12, C.goldRule)}
<line x1="${x}" y1="${H / 2 + 30}" x2="${x}" y2="${H - 150}" stroke="${C.softInk}" stroke-opacity="0.35" stroke-width="2"/>`;

// ---------- zones ----------
/** Just the glass mark, large, on the left. */
function brand() {
  return `
${mark(420, 170, 380)}
${sparkle(690, 200, 28)}
${sparkle(170, 700, 16, C.softInk, 0.6)}`;
}

function services() {
  const x0 = 860;
  const cardW = 920;
  const gap = 46;
  const top = 100;
  const h = 700;
  // Streaks of light behind the cards.
  const streaks = [0, 1, 2, 3]
    .map((i) => {
      const x = x0 + 400 + i * 1700;
      return `<path d="M${x} -20L${x + 260} -20L${x - 140} ${H + 20}L${x - 400} ${H + 20}Z" fill="#FFFFFF" fill-opacity="0.35"/>`;
    })
    .join('');
  let cards = '';
  CARDS.forEach((c, i) => {
    const x = x0 + i * (cardW + gap);
    const mid = x + cardW / 2;
    const hot = Boolean(c.popular);
    cards += `<path d="${rounded(x, top, cardW, h, 34)}" fill="url(#${hot ? 'cardHot' : 'card'})" stroke="${hot ? 'url(#goldDeep)' : C.softInk}" stroke-opacity="${hot ? 1 : 0.35}" stroke-width="${hot ? 6 : 3}"/>`;
    // The gold medallion with its icon.
    const my = top + 132;
    cards += `<circle cx="${mid}" cy="${my}" r="78" fill="url(#gold)"/><circle cx="${mid}" cy="${my}" r="90" fill="none" stroke="${C.goldRule}" stroke-opacity="0.6" stroke-width="2.5"/>`;
    cards += icon(c.icon, mid, my, 96);
    cards += text(`${c.id}-title`, mid, top + 334, C.indigoInk, 'middle');
    cards += text(`${c.id}-line`, mid, top + 408, C.goldInk, 'middle');
    cards += `<line x1="${mid - 80}" y1="${top + 448}" x2="${mid + 80}" y2="${top + 448}" stroke="${C.goldRule}" stroke-width="3"/>`;
    c.points.forEach((_, j) => {
      cards += text(`${c.id}-p${j}`, mid, top + 512 + j * 54, C.slate, 'middle');
    });
    if (hot) {
      const tw = T.popular.width + 80;
      cards += `<path d="${rounded(mid - tw / 2, top - 30, tw, 60, 30)}" fill="url(#gold)"/>`;
      cards += text('popular', mid, top + 12, C.ink, 'middle');
      cards += sparkle(x + cardW - 40, top + 44, 26) + sparkle(x + 46, top + h - 46, 16, C.goldRule, 0.7);
    }
  });
  return `
${streaks}
${cards}`;
}

function contact() {
  const x = 7700;
  const right = 8900;
  return `
${text('callLabel', x, 200, C.softInk)}
${text('primaryLabel', x, 268, C.goldInk)}
${text('primary', x, 384, C.indigoInk)}
${text('secondaryLabel', x, 456, C.goldInk)}
${text('secondary', x, 560, C.indigoInk)}
<line x1="${x}" y1="612" x2="${right}" y2="612" stroke="${C.goldRule}" stroke-width="2.5"/>
${text('ownerLabel', x, 674, C.goldInk)}
${text('owner', x, 762, C.inkDark)}
${sparkle(right - 20, 700, 20)}`;
}

// ---------- document ----------
const body = `
<rect width="${W}" height="${H}" fill="url(#pearl)"/>
${ribbon({ y0: 805, amp: 40, width: 110, phase: 0.4 })}
<rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="28" fill="none" stroke="url(#goldDeep)" stroke-opacity="0.7" stroke-width="3"/>
<rect x="54" y="54" width="${W - 108}" height="${H - 108}" rx="20" fill="none" stroke="${C.softInk}" stroke-opacity="0.14" stroke-width="1.5"/>
${brand()}
${divider(810)}
${services()}
${divider(7640)}
${contact()}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="9144mm" height="914.4mm" role="img" aria-label="Sri Mana Wash services board">
<title>Sri Mana Wash services board (30 ft × 3 ft)</title>
<defs>${defs}</defs>
${body}
</svg>
`;

const svgPath = join(HERE, 'mana-services-30x3.svg');
writeFileSync(svgPath, svg);
await sharp(Buffer.from(svg.replace('width="9144mm" height="914.4mm"', `width="${W}" height="${H}"`)))
  .png()
  .toFile(join(HERE, 'mana-services-30x3-preview.png'));
console.log('wrote mana-services-30x3.svg and preview');

// Print PDFs through headless Chrome (vector, at full size and at half scale), like the name board.
if (existsSync(CHROME)) {
  for (const [suffix, scale] of [
    ['', 1],
    ['-half-scale', 0.5],
  ]) {
    const w = `${9144 * scale}mm`;
    const h = `${914.4 * scale}mm`;
    const htmlPath = join(HERE, `.services-print${suffix}.html`);
    writeFileSync(
      htmlPath,
      `<!doctype html><meta charset="utf-8"><title>Sri Mana Wash services board</title><style>@page{size:${w} ${h};margin:0}html,body{margin:0;padding:0}img{display:block;width:${w};height:${h}}</style><img src="${pathToFileURL(svgPath).href}">`,
    );
    const out = join(HERE, `mana-services-30x3${suffix}.pdf`);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--print-to-pdf=${out}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
    execFileSync('rm', ['-f', htmlPath]);
    console.log('wrote', `mana-services-30x3${suffix}.pdf`);
  }
}
