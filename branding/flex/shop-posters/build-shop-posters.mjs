// Builds the shop's printed posters in the brand's indigo and gold, from the live menu so their
// prices always match the app and WhatsApp:
//   counter card (A5, two sides)  · UPI to pay, and "Rate us on Google"
//   plans poster (2 × 3 ft)       · the monthly wash plans per car size
//   price board  (4 × 3 ft)       · every wash × kind of vehicle
//   waiting poster (A3)           · "We'll WhatsApp you when it's ready"
//   valuables notice (A3)         · take cash, phones, gold and documents out
//   highway board (6 × 3 ft)      · the shop's direction sign
// Each as a print-ready SVG and vector PDF (headless Chrome, like the other boards) and a PNG preview.
//   node branding/flex/shop-posters/build-shop-posters.mjs
// Prices come from the staging API's catalog (set API to another host to change). Fill in UPI_ID,
// REVIEW_URL and HIGHWAY below; until then the counter card shows a marked placeholder.
// 1 unit = 1 mm on every poster.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import qrcode from 'qrcode-generator';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGO = join(HERE, '../../sri-mana-wash-logo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API = process.env.API ?? 'https://api-staging.manawashmanager.com';

// ─── Fill these in ────────────────────────────────────────────────────────────
/** The shop's UPI ID (e.g. "srimanawash@okaxis"); empty shows a placeholder. */
const UPI_ID = process.env.UPI_ID ?? '';
/** Google Business Profile → "Ask for reviews" link; empty shows a placeholder. */
const REVIEW_URL = process.env.REVIEW_URL ?? '';
/** The highway sign: how far, and which way (left or right). */
const HIGHWAY = { distance: process.env.HIGHWAY_DISTANCE ?? '200 m', arrow: process.env.HIGHWAY_ARROW ?? 'right' };

const NUMBER = '91547 52999';
const CHAT_URL = 'https://wa.me/919154752999?text=Hi';
const ADDRESS = 'Near Highway · Sai Baba Temple · Kovur';
const HOURS = 'Open daily 7 AM – 8 PM';
const SANS = 'Avenir Next';
const SERIF = 'Didot';
const TELUGU = 'Telugu Sangam MN';

// ─── The menu ────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else cell += ch;
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const [csv, info] = await Promise.all([
  fetch(`${API}/whatsapp/catalog.csv`).then((r) => r.text()),
  fetch(`${API}/whatsapp/catalog.json`).then((r) => r.json()),
]);
const cards = new Map(info.products.map((p) => [p.id, p]));
const products = parseCsv(csv).map((r) => {
  const [service, section] = r.id.split('--');
  return { id: r.id, service, section, label: r.custom_label_0, kind: r.custom_label_1 === 'Wash plans' ? 'plan' : 'service', price: Math.round(Number(r.price.split(' ')[0])), card: cards.get(r.id) };
});
const price = (service, section) => products.find((p) => p.service === service && p.section === section)?.price ?? null;
const cardOf = (service, section) => products.find((p) => p.service === service && p.section === section)?.card ?? null;
const rupees = (n) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);
/** Services in menu order, of one kind, on the menu for this section. */
const servicesIn = (section, kind) => [...new Set(products.filter((p) => p.section === section && p.kind === kind).map((p) => p.service))];
const titleOf = (service, section) => cardOf(service, section)?.title ?? service;
/** A service's one-line description, without anything about communities (not offered yet). */
const subtitleOf = (service, section) =>
  (cardOf(service, section)?.card?.subtitle ?? '')
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/communit/i.test(sentence))
    .join(' ') || null;

// ─── Shared drawing ──────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(file, x, y, width, prefix) {
  const src = readFileSync(join(LOGO, file), 'utf8');
  const [, vw, vh] = src.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const height = (width * Number(vh)) / Number(vw);
  const body = src
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
  return { svg: `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${vw} ${vh}" overflow="visible">${body}</svg>`, height };
}

let badgeN = 0;
/** A QR code on a white tile with the drop in the middle (high error correction). */
function qrTile(data, x, y, size, { badge = true } = {}) {
  const code = qrcode(0, 'H');
  code.addData(data);
  code.make();
  const n = code.getModuleCount();
  const quiet = 3;
  const m = size / (n + quiet * 2);
  let d = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (code.isDark(r, c)) d += `M${(x + (c + quiet) * m).toFixed(3)} ${(y + (r + quiet) * m).toFixed(3)}h${m.toFixed(3)}v${m.toFixed(3)}h-${m.toFixed(3)}z`;
  const b = size * 0.2;
  const mark = badge ? inline('sri-mana-wash-mark.svg', x + size / 2 - b * 0.32, y + size / 2 - b * 0.42, b * 0.64, `qb${badgeN++}`) : null;
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.06}" fill="#FFFFFF"/><path d="${d}" fill="#0C1442"/>` +
    (badge
      ? `<rect x="${x + size / 2 - b / 2 - size * 0.015}" y="${y + size / 2 - b / 2 - size * 0.015}" width="${b + size * 0.03}" height="${b + size * 0.03}" rx="${b * 0.24}" fill="#FFFFFF"/>` +
        `<rect x="${x + size / 2 - b / 2}" y="${y + size / 2 - b / 2}" width="${b}" height="${b}" rx="${b * 0.2}" fill="#1B2878"/>${mark.svg}`
      : '')
  );
}

/** A placeholder where a QR will go, until its link is filled in. */
const qrPlaceholder = (x, y, size, what) =>
  `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.06}" fill="#FFFFFF" fill-opacity="0.08" stroke="#F0CF8E" stroke-width="${size * 0.008}" stroke-dasharray="${size * 0.04} ${size * 0.03}"/>` +
  `<text x="${x + size / 2}" y="${y + size / 2 - size * 0.03}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${size * 0.07}" fill="#F8E2B0">ADD ${esc(what)}</text>` +
  `<text x="${x + size / 2}" y="${y + size / 2 + size * 0.07}" text-anchor="middle" font-family="${SANS}" font-size="${size * 0.05}" fill="#C4CCF0">then build again</text>`;

const sparkle = (x, y, r, o = 1, fill = '#F8E2B0') =>
  `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}" opacity="${o}"/>`;

const DEFS = `
<linearGradient id="night" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#1F2E86"/><stop offset="0.5" stop-color="#0E1650"/><stop offset="1" stop-color="#05081C"/></linearGradient>
<radialGradient id="spot" cx="0.5" cy="0.04" r="0.75"><stop offset="0" stop-color="#7E91F0" stop-opacity="0.5"/><stop offset="1" stop-color="#7E91F0" stop-opacity="0"/></radialGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1CF"/><stop offset="0.55" stop-color="#F0CF8E"/><stop offset="1" stop-color="#D2A250"/></linearGradient>
<linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E8BF78" stop-opacity="0"/><stop offset="0.5" stop-color="#F8E2B0"/><stop offset="1" stop-color="#E8BF78" stop-opacity="0"/></linearGradient>
<linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.09"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0.03"/></linearGradient>
<linearGradient id="rib" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9BAEF5" stop-opacity="0"/><stop offset="0.3" stop-color="#9BAEF5" stop-opacity="0.5"/><stop offset="0.7" stop-color="#9BAEF5" stop-opacity="0.5"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/></linearGradient>`;

/** The night background, spotlight, stars and gold frame every poster shares. */
function frame(W, H, k = 1) {
  const stars = [[0.1, 0.18], [0.9, 0.12], [0.06, 0.55], [0.94, 0.6], [0.15, 0.85], [0.85, 0.82], [0.5, 0.03]]
    .map(([x, y], i) => `<circle cx="${x * W}" cy="${y * H}" r="${(i % 2 ? 0.8 : 1.3) * k}" fill="#E6EAFF" opacity="0.55"/>`)
    .join('');
  const inset = 14 * k;
  return (
    `<rect width="${W}" height="${H}" fill="url(#night)"/><rect width="${W}" height="${H}" fill="url(#spot)"/>${stars}` +
    `<rect x="${inset}" y="${inset}" width="${W - inset * 2}" height="${H - inset * 2}" rx="${12 * k}" fill="none" stroke="#E8BF78" stroke-opacity="0.6" stroke-width="${1.1 * k}"/>`
  );
}

/** Ribbon of water lines along the bottom. */
const ribbon = (W, y, k = 1) =>
  `<path d="M0 ${y} C ${W * 0.25} ${y - 28 * k}, ${W * 0.42} ${y + 30 * k}, ${W * 0.66} ${y + 4 * k} S ${W * 0.9} ${y - 20 * k}, ${W} ${y}" fill="none" stroke="url(#rib)" stroke-width="${1.5 * k}"/>` +
  `<path d="M0 ${y + 18 * k} C ${W * 0.28} ${y - 8 * k}, ${W * 0.45} ${y + 44 * k}, ${W * 0.7} ${y + 22 * k} S ${W * 0.92} ${y - 2 * k}, ${W} ${y + 20 * k}" fill="none" stroke="url(#rib)" stroke-width="${k}" opacity="0.7"/>`;

const ICONS = {
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 9v6M18.5 9v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  gold: '<path d="M12 21c-4 0-7-2.6-7-6.2C5 10.6 9 7 12 5c3 2 7 5.6 7 9.8 0 3.6-3 6.2-7 6.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 3l3 2 3-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="14" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  docs: '<path d="M7 2.5h7l4 4v15H7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 2.5v4h4M9.5 11h6M9.5 14h6M9.5 17h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  keys: '<circle cx="8" cy="9" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11.2 12.2 20 21M16.5 17.5l2-2M18.5 19.5l2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  glasses: '<circle cx="7" cy="14" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="17" cy="14" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.6 14h2.8M3.4 13l1.6-6M20.6 13l-1.6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  wash: '<path d="M12 3c-3 4-5 6.6-5 9.4a5 5 0 0 0 10 0C17 9.6 15 7 12 3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 13a2.5 2.5 0 0 0 2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  chat: '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16a2.5 2.5 0 0 1-2-2.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 10.5l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  car: '<path d="M4 14l1.6-4.6A2 2 0 0 1 7.5 8h9a2 2 0 0 1 1.9 1.4L20 14v4h-2.2a2 2 0 0 1-3.6 0H9.8a2 2 0 0 1-3.6 0H4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="18" r="1.5" fill="currentColor"/><circle cx="16" cy="18" r="1.5" fill="currentColor"/>',
  bill: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  star: '<path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.3L12 15.8l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" fill="currentColor"/>',
  calendar: '<rect x="4" y="6" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 10.5h16M8.5 4v4M15.5 4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 14.5l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};
/** An icon in a gold ring, centred on (cx, cy), `r` its ring's radius. */
const ringIcon = (name, cx, cy, r, color = '#F0CF8E') =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" fill-opacity="0.05" stroke="#E8BF78" stroke-opacity="0.6" stroke-width="${r * 0.05}"/>` +
  `<g color="${color}" transform="translate(${cx - r * 0.62} ${cy - r * 0.62}) scale(${(r * 1.24) / 24})">${ICONS[name]}</g>`;

// ─── Output ──────────────────────────────────────────────────────────────────
const OUT = HERE;
mkdirSync(OUT, { recursive: true });
async function write(name, W, H, body, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<defs>${DEFS}</defs>
${body}
</svg>
`;
  const svgPath = join(OUT, `${name}.svg`);
  writeFileSync(svgPath, svg);
  const px = Math.round(Math.min(2400 / Math.max(W, H), 6) * 100) / 100;
  await sharp(Buffer.from(svg.replace(`width="${W}mm" height="${H}mm"`, `width="${Math.round(W * px)}" height="${Math.round(H * px)}"`)))
    .png()
    .toFile(join(OUT, `${name}-preview.png`));
  if (existsSync(CHROME)) {
    const htmlPath = join(OUT, `.${name}.html`);
    writeFileSync(
      htmlPath,
      `<!doctype html><meta charset="utf-8"><title>${esc(label)}</title><style>@page{size:${W}mm ${H}mm;margin:0}html,body{margin:0;padding:0}img{display:block;width:${W}mm;height:${H}mm}</style><img src="${pathToFileURL(svgPath).href}">`,
    );
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--print-to-pdf=${join(OUT, `${name}.pdf`)}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
    execFileSync('rm', ['-f', htmlPath]);
  }
  console.log(`wrote ${name} (${W} × ${H} mm)`);
}

// ─── 1. Counter card (A5, two sides) ─────────────────────────────────────────
{
  const W = 148;
  const H = 210;
  const k = 0.32;
  const logo = inline('sri-mana-wash-stacked-on-dark.svg', (W - 78) / 2, 16, 78, 'cf');
  const qs = 74;
  const upi = UPI_ID ? `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent('Sri Mana Wash')}&cu=INR` : null;
  await write(
    'counter-card-front-pay',
    W,
    H,
    `${frame(W, H, k)}
${logo.svg}
<text x="${W / 2}" y="${16 + logo.height + 18}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="4.6" letter-spacing="2.4" fill="#9BAEF5">SCAN TO PAY</text>
<text x="${W / 2}" y="${16 + logo.height + 31}" text-anchor="middle" font-family="${SERIF}" font-size="12" fill="#FFFFFF">Pay with <tspan font-style="italic" fill="url(#gold)">any UPI app</tspan></text>
${upi ? qrTile(upi, (W - qs) / 2, 98, qs) : qrPlaceholder((W - qs) / 2, 98, qs, 'UPI ID')}
<text x="${W / 2}" y="${98 + qs + 10}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="4.4" fill="#FFFFFF">${esc(UPI_ID || 'your-upi-id@bank')}</text>
<text x="${W / 2}" y="${98 + qs + 17}" text-anchor="middle" font-family="${SANS}" font-size="3.8" letter-spacing="0.6" fill="#C4CCF0">GPay · PhonePe · Paytm · BHIM · any bank app</text>
<text x="${W / 2}" y="${H - 15}" text-anchor="middle" font-family="${SANS}" font-size="3.6" fill="#9BAEF5">Your bill comes on WhatsApp from ${NUMBER}</text>`,
    'Sri Mana Wash counter card, front: pay by UPI',
  );
  const stars = [0, 1, 2, 3, 4].map((i) => `<g color="#F0CF8E" transform="translate(${W / 2 - 30 + i * 12} ${16 + logo.height + 22}) scale(0.5)">${ICONS.star}</g>`).join('');
  await write(
    'counter-card-back-review',
    W,
    H,
    `${frame(W, H, k)}
${logo.svg}
${stars}
<text x="${W / 2}" y="${16 + logo.height + 46}" text-anchor="middle" font-family="${SERIF}" font-size="13" fill="#FFFFFF">Loved the <tspan font-style="italic" fill="url(#gold)">shine?</tspan></text>
<text x="${W / 2}" y="${16 + logo.height + 55}" text-anchor="middle" font-family="${SANS}" font-size="4.4" fill="#C4CCF0">A quick Google review helps us a lot</text>
${REVIEW_URL ? qrTile(REVIEW_URL, (W - qs) / 2, 110, qs) : qrPlaceholder((W - qs) / 2, 110, qs, 'REVIEW LINK')}
<text x="${W / 2}" y="${110 + qs + 11}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="4.8" letter-spacing="1.6" fill="#F8E2B0">SCAN · RATE US ON GOOGLE</text>
<text x="${W / 2}" y="${110 + qs + 18}" text-anchor="middle" font-family="${TELUGU}" font-size="4" fill="#C4CCF0">మీ రివ్యూ మాకు చాలా విలువైనది</text>`,
    'Sri Mana Wash counter card, back: rate us on Google',
  );
}

// ─── 2. Plans poster (2 × 3 ft) ──────────────────────────────────────────────
{
  const W = 610;
  const H = 915;
  const CARS = [
    ['hatch', 'Hatchback'],
    ['sedan', 'Sedan'],
    ['suv', 'SUV / MUV'],
    ['luxury', 'Luxury'],
  ];
  const monthly = servicesIn('hatch', 'plan').filter((s) => !/-\d+-months?$/.test(s));
  const logo = inline('sri-mana-wash-horizontal-on-dark.svg', (W - 260) / 2, 40, 260, 'pl');
  let y = 40 + logo.height + 40;
  let body = `${frame(W, H)}${logo.svg}
<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="13" letter-spacing="7" fill="#9BAEF5">MONTHLY WASH PLANS</text>
<text x="${W / 2}" y="${y + 50}" text-anchor="middle" font-family="${SERIF}" font-size="44" fill="#FFFFFF">Wash every week.</text>
<text x="${W / 2}" y="${y + 96}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="42" fill="url(#gold)">Pay once, save more.</text>
<text x="${W / 2}" y="${y + 126}" text-anchor="middle" font-family="${TELUGU}" font-size="15" fill="#C4CCF0">నెలవారీ వాష్ ప్లాన్‌లు · ఒకసారి కట్టండి, ఆదా చేయండి</text>`;
  y += 150;
  for (const plan of monthly) {
    const c = cardOf(plan, 'hatch');
    const popular = c?.card?.popular;
    const lines = (c?.card?.lines ?? []).filter((l) => !l.startsWith('Just '));
    const upgrade = lines.find((l) => l.startsWith('Every '));
    const basics = lines.filter((l) => l !== upgrade);
    // The better wash every Nth time gets a line of its own.
    const extra = upgrade ? 20 : 0;
    const cardH = 150 + extra;
    body += `<rect x="40" y="${y}" width="${W - 80}" height="${cardH}" rx="16" fill="url(#panel)" stroke="${popular ? 'url(#gold)' : '#9BAEF5'}" stroke-opacity="${popular ? 1 : 0.35}" stroke-width="${popular ? 2 : 1}"/>`;
    body += `<text x="64" y="${y + 40}" font-family="${SERIF}" font-size="31" fill="#FFFFFF">${esc(titleOf(plan, 'hatch'))}</text>`;
    if (popular) body += `<rect x="${W - 64 - 108}" y="${y + 18}" width="108" height="28" rx="14" fill="url(#gold)"/><text x="${W - 64 - 54}" y="${y + 37}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="11.5" letter-spacing="2.4" fill="#1B2878">★ POPULAR</text>`;
    body += `<text x="64" y="${y + 63}" font-family="${SANS}" font-size="14" fill="#C4CCF0">${esc(basics.join('  ·  '))}</text>`;
    if (upgrade) body += `<text x="64" y="${y + 83}" font-family="${SANS}" font-size="14" fill="#F0CF8E">${esc(upgrade)}</text>`;
    const colW = (W - 128) / CARS.length;
    CARS.forEach(([section, label], i) => {
      const cx = 64 + colW * i + colW / 2;
      const save = cardOf(plan, section)?.card?.footer;
      body += `<text x="${cx}" y="${y + extra + 92}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="11.5" letter-spacing="1.5" fill="#9BAEF5">${esc(label.toUpperCase())}</text>`;
      body += `<text x="${cx}" y="${y + extra + 118}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="22" fill="#FFFFFF">${rupees(price(plan, section))}</text>`;
      if (save) body += `<text x="${cx}" y="${y + extra + 136}" text-anchor="middle" font-family="${SANS}" font-size="11" fill="#F0CF8E">${esc(save.toLowerCase())}</text>`;
    });
    y += cardH + 14;
  }
  // The longer plans and bikes on the left, the WhatsApp QR on the right.
  const bikeFrom = Math.min(...servicesIn('bike', 'plan').map((s) => price(s, 'bike')).filter((n) => n != null));
  const qs = 92;
  const qy = y + 8;
  body += qrTile(CHAT_URL, W - 64 - qs, qy, qs);
  body += `<text x="64" y="${qy + 20}" font-family="${SANS}" font-size="14" fill="#FFFFFF"><tspan font-weight="700" fill="#F8E2B0">3 months:</tspan> 13 washes for 3 months' price</text>`;
  body += `<text x="64" y="${qy + 42}" font-family="${SANS}" font-size="14" fill="#FFFFFF"><tspan font-weight="700" fill="#F8E2B0">12 months:</tspan> 13 months of washes for 12</text>`;
  body += `<text x="64" y="${qy + 64}" font-family="${SANS}" font-size="14" fill="#FFFFFF"><tspan font-weight="700" fill="#F8E2B0">Bikes &amp; scooters:</tspan> from ${rupees(bikeFrom)} a month</text>`;
  body += `<text x="64" y="${qy + 90}" font-family="${SANS}" font-size="13" fill="#C4CCF0">Ask at the counter, or scan &amp; say <tspan font-weight="700" fill="#F8E2B0">Hi</tspan> →</text>`;
  await write('plans-poster-2x3ft', W, H, body, 'Sri Mana Wash monthly plans poster (2 ft × 3 ft)');
}

// ─── 3. Price board (4 × 3 ft) ───────────────────────────────────────────────
{
  const W = 1220;
  const H = 915;
  const CARS = [
    ['hatch', 'Hatchback'],
    ['sedan', 'Sedan /|Compact SUV'],
    ['suv', 'SUV /|7-Seater'],
    ['luxury', 'Luxury car'],
  ];
  const BIKES = [
    ['bike', 'Scooter / Bike'],
    ['premium-bike', 'Premium bike'],
  ];
  const logo = inline('sri-mana-wash-horizontal-on-dark.svg', 60, 46, 330, 'pb');
  let body = `${frame(W, H, 1.4)}${logo.svg}
<text x="${W - 60}" y="86" text-anchor="end" font-family="${SERIF}" font-size="60" fill="#FFFFFF">Price list</text>
<text x="${W - 60}" y="120" text-anchor="end" font-family="${TELUGU}" font-size="22" fill="#C4CCF0">ధరల పట్టిక · షాప్ ధరలు</text>
<rect x="60" y="150" width="${W - 120}" height="1.2" fill="url(#goldLine)"/>`;
  // Cars.
  const nameW = 400;
  const colW = (W - 120 - nameW) / CARS.length;
  let y = 186;
  CARS.forEach(([, label], i) => {
    const cx = 60 + nameW + colW * i + colW / 2;
    body += ringIcon('car', cx, y - 4, 18);
    label.toUpperCase().split('|').forEach((part, j) => {
      body += `<text x="${cx}" y="${y + 36 + j * 20}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="16" letter-spacing="1.2" fill="#C4CCF0">${esc(part)}</text>`;
    });
  });
  y += 70;
  for (const s of servicesIn('hatch', 'service')) {
    const c = cardOf(s, 'hatch');
    const sub = subtitleOf(s, 'hatch');
    body += `<rect x="60" y="${y}" width="${W - 120}" height="72" rx="14" fill="url(#panel)"${c?.card?.popular ? ' stroke="url(#gold)" stroke-width="1.8"' : ''}/>`;
    body += `<text x="86" y="${y + (sub ? 36 : 46)}" font-family="${SERIF}" font-size="31" fill="#FFFFFF">${esc(titleOf(s, 'hatch'))}${c?.card?.popular ? ' <tspan font-family="' + SANS + '" font-size="14" font-weight="700" fill="#F0CF8E">★ POPULAR</tspan>' : ''}</text>`;
    if (sub) body += `<text x="86" y="${y + 58}" font-family="${SANS}" font-size="14" fill="#9BAEF5">${esc(sub)}</text>`;
    CARS.forEach(([section], i) => {
      const cx = 60 + nameW + colW * i + colW / 2;
      body += `<text x="${cx}" y="${y + 48}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="34" fill="#FFFFFF">${rupees(price(s, section))}</text>`;
    });
    y += 82;
  }
  // Bikes, then the plans and WhatsApp boxes.
  y += 14;
  const bikeX = 60;
  const bikeW = 640;
  const bNameW = 290;
  const bColW = (bikeW - bNameW) / BIKES.length;
  BIKES.forEach(([, label], i) => {
    const cx = bikeX + bNameW + bColW * i + bColW / 2;
    body += `<text x="${cx}" y="${y + 20}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="16" letter-spacing="1.2" fill="#C4CCF0">${esc(label.toUpperCase())}</text>`;
  });
  body += `<text x="${bikeX + 26}" y="${y + 20}" font-family="${SANS}" font-weight="700" font-size="16" letter-spacing="3" fill="#9BAEF5">TWO-WHEELERS</text>`;
  let by = y + 36;
  for (const s of servicesIn('bike', 'service')) {
    body += `<rect x="${bikeX}" y="${by}" width="${bikeW}" height="50" rx="12" fill="url(#panel)"/>`;
    body += `<text x="${bikeX + 26}" y="${by + 34}" font-family="${SERIF}" font-size="24" fill="#FFFFFF">${esc(titleOf(s, 'bike').replace(/^Bike /, ''))}</text>`;
    BIKES.forEach(([section], i) => {
      const cx = bikeX + bNameW + bColW * i + bColW / 2;
      body += `<text x="${cx}" y="${by + 35}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="26" fill="#FFFFFF">${rupees(price(s, section))}</text>`;
    });
    by += 58;
  }
  const boxX = bikeX + bikeW + 30;
  const boxW = W - 60 - boxX;
  const planFrom = Math.min(...servicesIn('hatch', 'plan').map((s) => price(s, 'hatch')).filter((n) => n != null));
  body += `<rect x="${boxX}" y="${y}" width="${boxW}" height="${Math.max(by - y - 8, 200)}" rx="16" fill="none" stroke="url(#gold)" stroke-width="2"/>`;
  body += ringIcon('calendar', boxX + 46, y + 40, 22);
  body += `<text x="${boxX + 82}" y="${y + 38}" font-family="${SERIF}" font-size="27" fill="#FFFFFF">Monthly plans</text>`;
  body += `<text x="${boxX + 82}" y="${y + 60}" font-family="${SANS}" font-size="15" fill="#C4CCF0">4 washes a month, from <tspan font-weight="700" fill="#F8E2B0">${rupees(planFrom)}</tspan></text>`;
  const qs = 104;
  const qy = y + 80;
  body += qrTile(CHAT_URL, boxX + 24, qy, qs);
  body += `<text x="${boxX + 24 + qs + 20}" y="${qy + 26}" font-family="${SANS}" font-weight="700" font-size="17" fill="#FFFFFF">Scan &amp; say Hi</text>`;
  body += `<text x="${boxX + 24 + qs + 20}" y="${qy + 50}" font-family="${SANS}" font-size="14" fill="#C4CCF0">your car's exact price,</text>`;
  body += `<text x="${boxX + 24 + qs + 20}" y="${qy + 70}" font-family="${SANS}" font-size="14" fill="#C4CCF0">plans &amp; bills on WhatsApp</text>`;
  body += `<text x="${boxX + 24 + qs + 20}" y="${qy + 96}" font-family="${SANS}" font-weight="700" font-size="16" fill="#F8E2B0">${NUMBER}</text>`;
  body += `<text x="${W / 2}" y="${H - 34}" text-anchor="middle" font-family="${SANS}" font-size="15" letter-spacing="2.5" fill="#9BAEF5">${esc(ADDRESS.toUpperCase())}  ·  ${esc(HOURS.toUpperCase())}</text>`;
  await write('price-board-4x3ft', W, H, body, 'Sri Mana Wash price board (4 ft × 3 ft)');
}

// ─── 4. Waiting-area poster (A3) ─────────────────────────────────────────────
{
  const W = 297;
  const H = 420;
  const k = 0.5;
  const logo = inline('sri-mana-wash-stacked-on-dark.svg', (W - 124) / 2, 30, 124, 'wt');
  let y = 30 + logo.height + 38;
  let body = `${frame(W, H, k)}${logo.svg}
<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SERIF}" font-size="30" fill="#FFFFFF">Relax.</text>
<text x="${W / 2}" y="${y + 24}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="15" fill="url(#gold)">We'll WhatsApp you when it's ready.</text>
<text x="${W / 2}" y="${y + 39}" text-anchor="middle" font-family="${TELUGU}" font-size="8" fill="#C4CCF0">మీ వాహనం సిద్ధమైనప్పుడు WhatsApp లో తెలియజేస్తాం</text>`;
  y += 62;
  const steps = [
    ['wash', 'We wash it', 'with care, inside and out'],
    ['chat', 'We WhatsApp you', `"Ready for pickup" from ${NUMBER}`],
    ['bill', 'Pick it up', 'and your bill comes on WhatsApp'],
  ];
  steps.forEach(([icon, title, line], i) => {
    const sy = y + i * 42;
    body += ringIcon(icon, 58, sy + 14, 14);
    body += `<text x="84" y="${sy + 11}" font-family="${SANS}" font-weight="700" font-size="10" fill="#FFFFFF">${i + 1}. ${esc(title)}</text>`;
    body += `<text x="84" y="${sy + 24}" font-family="${SANS}" font-size="7.6" fill="#C4CCF0">${esc(line)}</text>`;
    if (i < steps.length - 1) body += `<path d="M58 ${sy + 30} v12" stroke="#E8BF78" stroke-opacity="0.5" stroke-width="0.8" stroke-dasharray="1.6 1.6"/>`;
  });
  y += 128;
  const qs = 56;
  body += `<rect x="30" y="${y}" width="${W - 60}" height="${qs + 20}" rx="10" fill="url(#panel)" stroke="#E8BF78" stroke-opacity="0.45" stroke-width="0.6"/>`;
  body += qrTile(CHAT_URL, 40, y + 10, qs);
  body += `<text x="${40 + qs + 14}" y="${y + 30}" font-family="${SANS}" font-weight="700" font-size="9.4" fill="#FFFFFF">Not on our WhatsApp yet?</text>`;
  body += `<text x="${40 + qs + 14}" y="${y + 44}" font-family="${SANS}" font-size="8" fill="#C4CCF0">Scan &amp; say <tspan font-weight="700" fill="#F8E2B0">Hi</tspan> to get the</text>`;
  body += `<text x="${40 + qs + 14}" y="${y + 56}" font-family="${SANS}" font-size="8" fill="#C4CCF0">ready message and your bill</text>`;
  body += `<text x="${W / 2}" y="${H - 16}" text-anchor="middle" font-family="${SANS}" font-size="6.4" letter-spacing="1.4" fill="#9BAEF5">${esc(HOURS.toUpperCase())}</text>`;
  await write('waiting-area-a3', W, H, body, 'Sri Mana Wash waiting area poster (A3)');
}

// ─── 5. Valuables notice (A3) ────────────────────────────────────────────────
{
  const W = 297;
  const H = 420;
  const k = 0.5;
  const logo = inline('sri-mana-wash-horizontal-on-dark.svg', (W - 150) / 2, 28, 150, 'vl');
  let y = 28 + logo.height + 34;
  let body = `${frame(W, H, k)}${logo.svg}
<rect x="${W / 2 - 62}" y="${y - 12}" width="124" height="17" rx="8.5" fill="url(#gold)"/>
<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="7.6" letter-spacing="2.4" fill="#1B2878">PLEASE NOTE · <tspan letter-spacing="0" font-family="${TELUGU}">గమనిక</tspan></text>
<text x="${W / 2}" y="${y + 36}" text-anchor="middle" font-family="${SERIF}" font-size="25" fill="#FFFFFF">Take your valuables</text>
<text x="${W / 2}" y="${y + 62}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="25" fill="url(#gold)">with you</text>
<text x="${W / 2}" y="${y + 80}" text-anchor="middle" font-family="${TELUGU}" font-size="8.6" fill="#C4CCF0">దయచేసి విలువైన వస్తువులు వాహనం నుండి తీసుకోండి</text>`;
  y += 104;
  const items = [
    ['cash', 'Cash & wallets', 'నగదు'],
    ['phone', 'Phones', 'ఫోన్లు'],
    ['gold', 'Gold & jewellery', 'బంగారం'],
    ['docs', 'Documents', 'పత్రాలు'],
    ['keys', 'Spare keys', 'తాళాలు'],
    ['glasses', 'Glasses', 'కళ్ళద్దాలు'],
  ];
  const colW = (W - 60) / 3;
  items.forEach(([icon, label, te], i) => {
    const cx = 30 + colW * (i % 3) + colW / 2;
    const cy = y + Math.floor(i / 3) * 70 + 20;
    body += ringIcon(icon, cx, cy, 17);
    body += `<text x="${cx}" y="${cy + 31}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="8" fill="#FFFFFF">${esc(label)}</text>`;
    body += `<text x="${cx}" y="${cy + 42}" text-anchor="middle" font-family="${TELUGU}" font-size="7" fill="#9BAEF5">${te}</text>`;
  });
  y += 150;
  body += `<rect x="40" y="${y}" width="${W - 80}" height="0.6" fill="url(#goldLine)"/>`;
  body += `<text x="${W / 2}" y="${y + 18}" text-anchor="middle" font-family="${SANS}" font-size="7.6" fill="#C4CCF0">We are not responsible for items left in the vehicle.</text>`;
  body += `<text x="${W / 2}" y="${y + 30}" text-anchor="middle" font-family="${TELUGU}" font-size="7.2" fill="#9BAEF5">వాహనంలో వదిలిన వస్తువులకు మేము బాధ్యులం కాదు.</text>`;
  body += `<text x="${W / 2}" y="${H - 22}" text-anchor="middle" font-family="${SANS}" font-size="6.4" letter-spacing="1.4" fill="#9BAEF5">THANK YOU · <tspan letter-spacing="0" font-family="${TELUGU}">ధన్యవాదాలు</tspan></text>`;
  await write('valuables-notice-a3', W, H, body, 'Sri Mana Wash valuables notice (A3)');
}

// ─── 6. Highway board (6 × 3 ft) ─────────────────────────────────────────────
{
  const W = 1830;
  const H = 915;
  const right = HIGHWAY.arrow !== 'left';
  const markH = 460;
  const mark = inline('sri-mana-wash-mark.svg', right ? 120 : W - 120 - markH * (295.1 / 383.5), (H - markH) / 2 - 30, markH * (295.1 / 383.5), 'hw');
  const textX = right ? 520 : 140;
  const name = inline('sri-mana-wash-name-on-dark.svg', textX, 150, 1000, 'hn');
  const arrowY = 610;
  const ax = right ? textX : textX + 300;
  const arrow = right
    ? `<path d="M${ax} ${arrowY - 30} H${ax + 560} V${arrowY - 85} L${ax + 720} ${arrowY} L${ax + 560} ${arrowY + 85} V${arrowY + 30} H${ax} Z" fill="url(#gold)"/>`
    : `<path d="M${ax + 720} ${arrowY - 30} H${ax + 160} V${arrowY - 85} L${ax} ${arrowY} L${ax + 160} ${arrowY + 85} V${arrowY + 30} H${ax + 720} Z" fill="url(#gold)"/>`;
  const body = `${frame(W, H, 2.2)}
${mark.svg}
${name.svg}
<text x="${textX + 6}" y="${150 + name.height + 92}" font-family="${SANS}" font-weight="700" font-size="76" letter-spacing="14" fill="#C4CCF0">CAR &amp; BIKE WASH</text>
<text x="${textX + 6}" y="${150 + name.height + 150}" font-family="${TELUGU}" font-size="48" fill="#9BAEF5">కార్ &amp; బైక్ వాష్</text>
${arrow}
<text x="${right ? ax + 290 : ax + 430}" y="${arrowY + 22}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="68" fill="#1B2878">${esc(HIGHWAY.distance)}</text>
<text x="${right ? ax + 860 : ax - 140}" y="${arrowY - 8}" text-anchor="${right ? 'start' : 'end'}" font-family="${SANS}" font-weight="700" font-size="44" fill="#FFFFFF">7 AM – 8 PM</text>
<text x="${right ? ax + 860 : ax - 140}" y="${arrowY + 46}" text-anchor="${right ? 'start' : 'end'}" font-family="${SANS}" font-size="34" letter-spacing="4" fill="#C4CCF0">EVERY DAY</text>
${ribbon(W, H - 120, 2.2)}`;
  await write('highway-board-6x3ft', W, H, body, 'Sri Mana Wash highway direction board (6 ft × 3 ft)');
}
