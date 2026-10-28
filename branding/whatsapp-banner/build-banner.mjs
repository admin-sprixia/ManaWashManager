// Builds the picture on top of the WhatsApp welcome message, in the style of the banks' WhatsApp
// banners: a phone showing our chat menu on the left, and on the right the Sri Mana Wash logo,
// "Car care is as easy as chatting", and what customers get on WhatsApp in this version (prices
// for their model, wash plans, bills, ready-for-pickup alerts). Nothing about doorstep washes or
// booking until those launch.
//   node branding/whatsapp-banner/build-banner.mjs
//
// WhatsApp shows a header image at about 1.91:1, so it's 1200 × 628 (drawn at 2× for sharpness),
// with everything kept inside the edges. Writes the JPEG the API serves
// (apps/api/src/assets/whatsapp-banner.jpg) and a PNG copy here. Bump BANNER_VERSION in
// apps/api/src/routes/whatsapp.ts after changing it, since WhatsApp caches the picture by its link.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const W = 1200;
const H = 628;
const SCALE = 2;
const SANS = 'Avenir Next';
const TELUGU = 'Telugu Sangam MN';

const sparkle = (x, y, r, fill = '#F8E2B0', o = 1) =>
  `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}" opacity="${o}"/>`;

// ─── Icons (24-unit grid, drawn in white on a coloured tile) ─────────────────
const ICONS = {
  car: `<path d="M4 14l1.6-4.6A2 2 0 0 1 7.5 8h9a2 2 0 0 1 1.9 1.4L20 14v4h-2.2a2 2 0 0 1-3.6 0H9.8a2 2 0 0 1-3.6 0H4z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M6.5 12.5h11" stroke="#fff" stroke-width="1.6"/><circle cx="8" cy="18" r="1.6" fill="#fff"/><circle cx="16" cy="18" r="1.6" fill="#fff"/>`,
  pin: `<path d="M12 21s-6-5.6-6-10.5A6 6 0 0 1 18 10.5C18 15.4 12 21 12 21z" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="10.5" r="2.2" fill="#fff"/>`,
  calendar: `<rect x="4" y="6" width="16" height="14" rx="2.5" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M4 10.5h16M8.5 4v4M15.5 4v4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M9 14.5l2 2 4-4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  bill: `<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
  bell: `<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 20.5a2 2 0 0 0 4 0" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`,
  tag: `<path d="M4 12.5V5a1 1 0 0 1 1-1h7.5L20 11.5 12.5 19z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.6" fill="#fff"/>`,
  star: `<path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.3L12 15.8l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>`,
  chat: `<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h0a2.5 2.5 0 0 1-2-2.5z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>`,
};
const icon = (name, x, y, size, tile) =>
  `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.28}" fill="${tile}"/>` +
  `<g transform="translate(${x + size * 0.14} ${y + size * 0.14}) scale(${(size * 0.72) / 24})">${ICONS[name]}</g>`;

// ─── The phone: our chat with its menu ───────────────────────────────────────
const PX = 78;
const PY = 70;
const PW = 300;
const PH = 520;
const menuRow = (i, name, label) => {
  const y = PY + 190 + i * 66;
  return (
    `<rect x="${PX + 22}" y="${y}" width="${PW - 44}" height="54" rx="12" fill="#FFFFFF"/>` +
    `<rect x="${PX + 22}" y="${y}" width="${PW - 44}" height="54" rx="12" fill="none" stroke="#C4CCF0"/>` +
    icon(name, PX + 32, y + 9, 36, '#25A35A') +
    `<text x="${PX + 80}" y="${y + 34}" font-family="${SANS}" font-weight="600" font-size="19" fill="#1B2878">${label}</text>`
  );
};
const phone = `
<g filter="url(#shadow)">
  <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="42" fill="#0A0F2C"/>
  <rect x="${PX + 10}" y="${PY + 10}" width="${PW - 20}" height="${PH - 20}" rx="34" fill="url(#chatbg)"/>
</g>
<rect x="${PX + 10}" y="${PY + 10}" width="${PW - 20}" height="86" rx="34" fill="#075E54"/>
<rect x="${PX + 10}" y="${PY + 60}" width="${PW - 20}" height="36" fill="#075E54"/>
<rect x="${PX + PW / 2 - 50}" y="${PY + 18}" width="100" height="22" rx="11" fill="#0A0F2C"/>
<circle cx="${PX + 52}" cy="${PY + 70}" r="17" fill="#1B2878"/>
<path d="M${PX + 52} ${PY + 58}c-5 7-8 11-8 15a8 8 0 0 0 16 0c0-4-3-8-8-15z" fill="#9BAEF5"/><path d="M${PX + 52} ${PY + 63}v12" stroke="#E0303A" stroke-width="2.4" stroke-linecap="round"/>
<text x="${PX + 78}" y="${PY + 68}" font-family="${SANS}" font-weight="600" font-size="17" fill="#FFFFFF">Sri Mana Wash</text>
<circle cx="${PX + 214}" cy="${PY + 62}" r="7" fill="#25D366"/><path d="M${PX + 210.5} ${PY + 62}l2.5 2.5 4-4.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${PX + 78}" y="${PY + 86}" font-family="${SANS}" font-size="13" fill="#CDEBE6">Business account</text>
<rect x="${PX + PW - 120}" y="${PY + 116}" width="90" height="40" rx="12" fill="#D9FDD3"/>
<text x="${PX + PW - 75}" y="${PY + 142}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="18" fill="#111B21">Hi 👋</text>
${menuRow(0, 'car', 'Services &amp; Prices')}
${menuRow(1, 'pin', 'Get Directions')}
${menuRow(2, 'calendar', 'Wash Plans')}
${menuRow(3, 'star', 'Rate Us')}
`;

// ─── The right side: logo, promise, what you get ─────────────────────────────
const RX = 450;
const feature = (col, row, name, tile, lines) => {
  const x = RX + 26 + col * 345;
  const y = 300 + row * 104;
  return (
    icon(name, x, y, 58, tile) +
    lines
      .map(
        (l, i) =>
          `<text x="${x + 74}" y="${y + (lines.length === 1 ? 37 : 25 + i * 26)}" font-family="${SANS}" font-weight="700" font-size="21" fill="#1B2878">${l}</text>`,
      )
      .join('')
  );
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2A3A9C"/><stop offset="0.5" stop-color="#1B2878"/><stop offset="1" stop-color="#0C1442"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.2" cy="0.55" r="0.45">
    <stop offset="0" stop-color="#5468D4" stop-opacity="0.7"/><stop offset="1" stop-color="#5468D4" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="aqua" cx="0.95" cy="0" r="0.45">
    <stop offset="0" stop-color="#5EEAD4" stop-opacity="0.35"/><stop offset="1" stop-color="#5EEAD4" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="chatbg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#EFEAE2"/><stop offset="1" stop-color="#E4DDD3"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFE7A8"/><stop offset="1" stop-color="#E8B45C"/>
  </linearGradient>
  <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#F4F6FF"/><stop offset="1" stop-color="#E3E8FF"/>
  </linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#030614" flood-opacity="0.55"/>
  </filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<rect width="${W}" height="${H}" fill="url(#aqua)"/>
<path d="M0 520 C 200 470, 330 600, 560 560 S 960 470, 1200 520 V628 H0Z" fill="#0C1442" opacity="0.55"/>
${[[40, 60], [420, 40], [1150, 300], [30, 330], [430, 600], [700, 610], [1170, 600]]
  .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 2 ? 1.8 : 2.6}" fill="#C4CCF0" opacity="0.5"/>`)
  .join('')}
${sparkle(410, 120, 13)}${sparkle(48, 470, 10, '#F8E2B0', 0.8)}${sparkle(1150, 70, 9, '#FFFFFF', 0.7)}${sparkle(420, 520, 7, '#FFFFFF', 0.6)}
${phone}
<text x="${RX + 2}" y="166" font-family="${SANS}" font-weight="700" font-size="40" fill="#FFFFFF">Car care is as <tspan fill="url(#gold)">easy as chatting</tspan></text>
<path d="M${RX} 192 H${W - 50}" stroke="#9BAEF5" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="5 6"/>
<rect x="${RX + 230}" y="212" width="240" height="46" rx="23" fill="url(#gold)"/>
<text x="${RX + 350}" y="243" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="22" fill="#1B2878">On WhatsApp</text>
${sparkle(RX + 205, 228, 10, '#FFFFFF')}${sparkle(RX + 498, 240, 12, '#FFFFFF')}
<rect x="${RX}" y="276" width="${W - 50 - RX}" height="226" rx="22" fill="url(#panel)"/>
${feature(0, 0, 'tag', '#3A4DB0', ['Prices for your', 'exact model'])}
${feature(1, 0, 'calendar', '#0E9F8E', ['Monthly plans', 'that save more'])}
${feature(0, 1, 'bill', '#C2410C', ['Bills straight', 'to your chat'])}
${feature(1, 1, 'bell', '#B45309', ['Ready-for-pickup', 'alerts'])}
<rect x="${RX + 40}" y="522" width="${W - 130 - RX}" height="58" rx="29" fill="#0C1442" stroke="url(#gold)" stroke-width="2"/>
${icon('chat', RX + 54, 531, 40, '#25A35A')}
<text x="${RX + 108}" y="559" font-family="${SANS}" font-size="21" fill="#FFFFFF"><tspan font-weight="700">Just say Hi</tspan> · Reply in English or <tspan font-family="${TELUGU}" font-weight="700" fill="#F8E2B0">తెలుగు</tspan></text>
</svg>`;

const logoHeight = 74;
const logo = await sharp(join(ROOT, 'branding/sri-mana-wash-logo/sri-mana-wash-horizontal-on-dark.png'))
  .resize({ height: logoHeight * SCALE })
  .toBuffer();

const banner = sharp(Buffer.from(svg)).composite([{ input: logo, left: (RX - 6) * SCALE, top: 34 * SCALE }]);
const full = await banner.png().toBuffer();
await sharp(full).resize(W, H).png().toFile(join(HERE, 'whatsapp-banner.png'));
await sharp(full).resize(W, H).jpeg({ quality: 88, mozjpeg: true }).toFile(join(ROOT, 'apps/api/src/assets/whatsapp-banner.jpg'));
console.log('wrote whatsapp-banner.png and apps/api/src/assets/whatsapp-banner.jpg');
